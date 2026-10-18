import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startApi } from "./api.js";
import { closeHelpers, queueMessage, resetData, sample, seedJob, testDb } from "./helpers.js";

let api: Awaited<ReturnType<typeof startApi>>;

beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
  await closeHelpers();
});
beforeEach(resetData);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("request ids", () => {
  it("gives every response an X-Request-Id", async () => {
    const response = await fetch(`${api.baseUrl}/jobs`);
    expect(response.headers.get("x-request-id")).toMatch(UUID);
  });

  it("reuses a safe X-Request-Id from the caller", async () => {
    const response = await fetch(`${api.baseUrl}/jobs`, { headers: { "X-Request-Id": "demo-123" } });
    expect(response.headers.get("x-request-id")).toBe("demo-123");
  });

  it("replaces an X-Request-Id with unsafe characters", async () => {
    const response = await fetch(`${api.baseUrl}/jobs`, { headers: { "X-Request-Id": "a b\"c" } });
    expect(response.headers.get("x-request-id")).toMatch(UUID);
  });

  it("passes the request id to the worker in the queue message", async () => {
    const { audioId } = (await api.upload(await sample("sample.mp3"), "sample.mp3")).body;
    const response = await fetch(`${api.baseUrl}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "trace-me" },
      body: JSON.stringify({ audioId }),
    });
    const { jobId } = (await response.json()) as { jobId: string };

    expect(await queueMessage(jobId)).toEqual({ jobId, requestId: "trace-me" });
  });
});

describe("GET /metrics", () => {
  async function metrics() {
    const response = await fetch(`${api.baseUrl}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    return response.text();
  }

  it("reports zeros on an empty system", async () => {
    const text = await metrics();
    expect(text).toContain('audio_jobs{status="queued"} 0');
    expect(text).toContain('audio_jobs{status="failed"} 0');
    expect(text).toContain("audio_jobs_oldest_queued_seconds 0");
    expect(text).toContain("audio_queue_up 1");
    expect(text).toContain('audio_queue_messages{state="waiting"} 0');
  });

  it("counts jobs, attempts and failures from the database", async () => {
    const completed = await seedJob({});
    const failed = await seedJob({});
    await seedJob({});
    await testDb.query(
      `INSERT INTO job_attempts (job_id, attempt_number, status, error_code, retryable, started_at, finished_at) VALUES
       ($1, 1, 'failed', 'PROCESSOR_UNAVAILABLE', true, now() - interval '9 seconds', now() - interval '8 seconds'),
       ($1, 2, 'succeeded', NULL, NULL, now() - interval '3 seconds', now()),
       ($2, 1, 'failed', 'INVALID_AUDIO', false, now() - interval '1 second', now())`,
      [completed.jobId, failed.jobId],
    );
    await testDb.query("UPDATE jobs SET status = 'completed', progress = 100, finished_at = now() WHERE id = $1", [
      completed.jobId,
    ]);
    await testDb.query(
      "UPDATE jobs SET status = 'failed', error_code = 'INVALID_AUDIO', finished_at = now() WHERE id = $1",
      [failed.jobId],
    );

    const text = await metrics();

    expect(text).toContain('audio_jobs{status="queued"} 1');
    expect(text).toContain('audio_jobs{status="completed"} 1');
    expect(text).toContain('audio_jobs{status="failed"} 1');
    expect(text).toContain('audio_job_attempts_total{outcome="succeeded"} 1');
    expect(text).toContain('audio_job_attempts_total{outcome="failed"} 2');
    expect(text).toContain('audio_job_attempt_failures_total{code="INVALID_AUDIO"} 1');
    expect(text).toContain('audio_job_attempt_failures_total{code="PROCESSOR_UNAVAILABLE"} 1');
    expect(text).toContain('audio_job_attempt_duration_seconds{quantile="0.5"} 3');
    expect(Number(text.match(/^audio_jobs_oldest_queued_seconds (\S+)$/m)?.[1])).toBeGreaterThanOrEqual(0);
  });

  it("shows a new job as waiting in the queue", async () => {
    const { audioId } = (await api.upload(await sample("sample.mp3"), "sample.mp3")).body;
    await api.createJob({ audioId });

    expect(await metrics()).toContain('audio_queue_messages{state="waiting"} 1');
  });
});