import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startApi } from "../../api/test/api.js";
import { closeHelpers, resetData, sample } from "../../api/test/helpers.js";
import { db, s3 } from "../src/clients.js";
import { FailureInjectingProcessor } from "../src/processor/failure-injection.js";
import { MockProcessor } from "../src/processor/mock-processor.js";
import { createWorker } from "../src/worker.js";

// The whole chain with real services: HTTP upload -> job -> Redis queue -> worker -> results.

let api: Awaited<ReturnType<typeof startApi>>;
let worker: ReturnType<typeof createWorker>;

beforeAll(async () => {
  api = await startApi();
  worker = createWorker(new FailureInjectingProcessor(new MockProcessor(0), 0), 2);
  await worker.waitUntilReady();
});
afterAll(async () => {
  await worker.close();
  await api.stop();
  await db.end();
  s3.destroy();
  await closeHelpers();
});
beforeEach(resetData);

// Polls GET /jobs/:id, like the web app does, until the check passes.
async function waitForJob(jobId: string, check: (job: any) => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await api.get(`/jobs/${jobId}`);
    if (check(body)) return body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`job ${jobId} did not reach the expected state in time`);
}

const finished = (job: any) => job.status === "completed" || job.status === "failed";

async function submit(file: string, resultCount: number, uploadName = file) {
  const { body: upload } = await api.upload(await sample(file), uploadName);
  const { body: job } = await api.createJob({ audioId: upload.audioId, resultCount });
  return job.jobId as string;
}

describe("upload to results", () => {
  it("processes a job in the background and returns exactly N results", async () => {
    const jobId = await submit("sample.m4a", 6);

    const job = await waitForJob(jobId, finished);
    const { status, body } = await api.get(`/jobs/${jobId}/results`);

    expect(job.status).toBe("completed");
    expect(status).toBe(200);
    expect(body.results).toHaveLength(6);
  });

  it("retries a temporary failure with backoff and then succeeds", async () => {
    const jobId = await submit("sample.mp3", 3, "meeting-fail-once.mp3");

    // First the failed attempt: the job waits for its retry.
    const retrying = await waitForJob(jobId, (job) => job.retry !== null, 5_000);
    expect(retrying).toMatchObject({ status: "queued", retry: { lastError: { code: "PROCESSOR_UNAVAILABLE" } } });

    const done = await waitForJob(jobId, finished);
    expect(done).toMatchObject({ status: "completed", attempts: 2 });

    const { body } = await api.get(`/jobs/${jobId}/attempts`);
    expect(body.attempts.map((a: { status: string }) => a.status)).toEqual(["failed", "succeeded"]);
    const waitedMs = Date.parse(body.attempts[1].startedAt) - Date.parse(body.attempts[0].finishedAt);
    expect(waitedMs).toBeGreaterThanOrEqual(1_900); // backoff of 2 s before the first retry
  });

  it("ends a broken file as failed after a single attempt", async () => {
    const jobId = await submit("broken-audio.mp3", 3);

    const job = await waitForJob(jobId, finished);

    expect(job).toMatchObject({ status: "failed", attempts: 1, error: { code: "INVALID_AUDIO" } });
  });
});