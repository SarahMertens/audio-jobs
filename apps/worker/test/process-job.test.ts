import { UnrecoverableError } from "bullmq";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeHelpers, getAttemptRows, getJobRow, resetData, seedJob, testDb } from "../../api/test/helpers.js";
import { db, s3 } from "../src/clients.js";
import { processJob } from "../src/process-job.js";
import { MockProcessor } from "../src/processor/mock-processor.js";
import { FakeProcessor } from "./fake-processor.js";

const firstDelivery = { attemptsMade: 0, maxAttempts: 4 };

afterAll(async () => {
  await db.end();
  s3.destroy();
  await closeHelpers();
});
beforeEach(resetData);

async function resultCount(jobId: string) {
  const result = await testDb.query("SELECT count(*)::int AS n FROM results WHERE job_id = $1", [jobId]);
  return result.rows[0].n as number;
}

describe("processJob", () => {
  it("completes a job with exactly N results", async () => {
    const { jobId } = await seedJob({ resultCount: 7 });

    await expect(processJob(jobId, new FakeProcessor(), firstDelivery)).resolves.toBe("completed");

    expect(await getJobRow(jobId)).toMatchObject({ status: "completed", progress: 100, attempt_count: 1 });
    expect(await resultCount(jobId)).toBe(7);
    expect((await getAttemptRows(jobId)).map((a) => a.status)).toEqual(["succeeded"]);
  });

  it("works with the real mock processor and real audio", async () => {
    const { jobId } = await seedJob({ file: "sample.wav", mimeType: "audio/wav", resultCount: 4 });

    await processJob(jobId, new MockProcessor(0), firstDelivery);

    const rows = await testDb.query("SELECT position, start_ms, end_ms FROM results WHERE job_id = $1 ORDER BY position", [jobId]);
    expect(rows.rows.map((r) => r.position)).toEqual([1, 2, 3, 4]);
    expect(rows.rows.at(-1).end_ms).toBe(3000); // sample.wav is exactly 3 seconds long
  });

  it("ignores a duplicate message for a job that is already completed", async () => {
    const { jobId } = await seedJob({ resultCount: 3 });
    const processor = new FakeProcessor();
    await processJob(jobId, processor, firstDelivery);

    await expect(processJob(jobId, processor, firstDelivery)).resolves.toBe("skipped");

    expect(processor.calls).toHaveLength(1);
    expect(await resultCount(jobId)).toBe(3);
  });

  it("puts a job back in the queue after a temporary failure", async () => {
    const { jobId } = await seedJob({});
    const processor = new FakeProcessor({ kind: "fail", code: "PROCESSOR_UNAVAILABLE", retryable: true });

    const attempt = processJob(jobId, processor, firstDelivery);

    // A normal error (not UnrecoverableError) tells BullMQ to retry after the backoff.
    await expect(attempt).rejects.toThrow("PROCESSOR_UNAVAILABLE");
    await expect(attempt).rejects.not.toBeInstanceOf(UnrecoverableError);
    const job = await getJobRow(jobId);
    expect(job).toMatchObject({ status: "queued", error_code: "PROCESSOR_UNAVAILABLE", attempt_count: 1 });
    expect(job.next_retry_at).not.toBeNull();
    expect(await getAttemptRows(jobId)).toMatchObject([{ status: "failed", retryable: true }]);
  });

  it("succeeds on the retry after a temporary failure", async () => {
    const { jobId } = await seedJob({ resultCount: 2 });
    const processor = new FakeProcessor({ kind: "fail", code: "PROCESSOR_UNAVAILABLE", retryable: true });
    await processJob(jobId, processor, firstDelivery).catch(() => {});

    processor.setBehaviour({ kind: "succeed" });
    await processJob(jobId, processor, { attemptsMade: 1, maxAttempts: 4 });

    expect(await getJobRow(jobId)).toMatchObject({ status: "completed", attempt_count: 2, error_code: null });
    expect((await getAttemptRows(jobId)).map((a) => a.status)).toEqual(["failed", "succeeded"]);
    expect(processor.calls.map((c) => c.attempt)).toEqual([1, 2]);
  });

  it("stops after the last attempt and marks the job failed", async () => {
    const { jobId } = await seedJob({});
    const processor = new FakeProcessor({ kind: "fail", code: "PROCESSOR_UNAVAILABLE", retryable: true });
    await testDb.query("UPDATE jobs SET attempt_count = 3 WHERE id = $1", [jobId]);

    await expect(processJob(jobId, processor, { attemptsMade: 3, maxAttempts: 4 })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(await getJobRow(jobId)).toMatchObject({ status: "failed", error_code: "PROCESSOR_UNAVAILABLE", attempt_count: 4 });
  });

  it("does not retry a file that can't be decoded", async () => {
    const { jobId } = await seedJob({ file: "broken-audio.mp3" });

    await expect(processJob(jobId, new MockProcessor(0), firstDelivery)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(await getJobRow(jobId)).toMatchObject({ status: "failed", error_code: "INVALID_AUDIO", attempt_count: 1 });
    expect(await getAttemptRows(jobId)).toMatchObject([{ retryable: false }]);
  });

  it("fails without retry when the audio is gone from storage", async () => {
    const { jobId } = await seedJob({ uploadObject: false });

    await expect(processJob(jobId, new FakeProcessor(), firstDelivery)).rejects.toBeInstanceOf(UnrecoverableError);
    expect((await getJobRow(jobId)).error_code).toBe("AUDIO_MISSING");
  });

  it("rejects a processor that returns the wrong number of results", async () => {
    const { jobId } = await seedJob({ resultCount: 5 });

    await expect(processJob(jobId, new FakeProcessor({ kind: "wrong-count" }), firstDelivery)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect((await getJobRow(jobId)).error_code).toBe("INVALID_PROCESSOR_OUTPUT");
    expect(await resultCount(jobId)).toBe(0);
  });

  it("never stores the text of an unexpected error", async () => {
    const { jobId } = await seedJob({});
    await processJob(jobId, new FakeProcessor({ kind: "throw-unknown" }), firstDelivery).catch(() => {});

    const job = await getJobRow(jobId);
    expect(job.error_code).toBe("INTERNAL_ERROR");
    expect(job.error_message).not.toContain("hunter2");
  });

  it("records a crashed attempt as WORKER_LOST and starts a new one", async () => {
    const { jobId } = await seedJob({});
    // State left behind by a worker that died in the middle of attempt 1.
    await testDb.query("UPDATE jobs SET status = 'running', attempt_count = 1 WHERE id = $1", [jobId]);
    await testDb.query("INSERT INTO job_attempts (job_id, attempt_number) VALUES ($1, 1)", [jobId]);

    await processJob(jobId, new FakeProcessor(), firstDelivery);

    expect(await getAttemptRows(jobId)).toMatchObject([
      { attempt_number: 1, status: "failed", error_code: "WORKER_LOST" },
      { attempt_number: 2, status: "succeeded" },
    ]);
  });

  it("gives up on a job that keeps crashing workers", async () => {
    const { jobId } = await seedJob({});
    await testDb.query("UPDATE jobs SET status = 'running', attempt_count = 4 WHERE id = $1", [jobId]);
    const processor = new FakeProcessor();

    await expect(processJob(jobId, processor, firstDelivery)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(processor.calls).toHaveLength(0);
    expect(await getJobRow(jobId)).toMatchObject({ status: "failed", error_code: "ATTEMPTS_EXHAUSTED" });
  });
});