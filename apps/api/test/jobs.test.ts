import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startApi } from "./api.js";
import { closeHelpers, getJobRow, queueHasJob, resetData, sample, seedJob, testDb } from "./helpers.js";

let api: Awaited<ReturnType<typeof startApi>>;
let audioId: string;

beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
  await closeHelpers();
});
beforeEach(async () => {
  await resetData();
  audioId = (await api.upload(await sample("sample.mp3"), "sample.mp3")).body.audioId;
});

describe("POST /jobs", () => {
  it("stores the job, puts it on the queue and answers 202 right away", async () => {
    const response = await api.createJob({ audioId, resultCount: 3 });

    expect(response.status).toBe(202);
    expect(response.body.status).toBe("queued");
    expect(response.headers.get("location")).toBe(`/jobs/${response.body.jobId}`);
    expect((await getJobRow(response.body.jobId)).result_count).toBe(3);
    expect(await queueHasJob(response.body.jobId)).toBe(true);
  });

  it("uses 5 results when no count is given", async () => {
    const response = await api.createJob({ audioId });
    expect((await getJobRow(response.body.jobId)).result_count).toBe(5);
  });

  it("returns the same job for the same Idempotency-Key", async () => {
    const first = await api.createJob({ audioId, resultCount: 3 }, "key-1");
    const second = await api.createJob({ audioId, resultCount: 3 }, "key-1");

    expect(second.status).toBe(202);
    expect(second.body.jobId).toBe(first.body.jobId);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
  });

  it("creates exactly one job when the same request arrives 10 times at once", async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => api.createJob({ audioId, resultCount: 3 }, "same-key")),
    );

    expect(new Set(responses.map((r) => r.body.jobId)).size).toBe(1);
    const count = await testDb.query("SELECT count(*)::int AS n FROM jobs WHERE idempotency_key = 'same-key'");
    expect(count.rows[0].n).toBe(1);
  });

  it("refuses a reused Idempotency-Key with a different body", async () => {
    await api.createJob({ audioId, resultCount: 3 }, "key-2");
    const response = await api.createJob({ audioId, resultCount: 7 }, "key-2");

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("answers 404 for an unknown audio file", async () => {
    const response = await api.createJob({ audioId: randomUUID() });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("AUDIO_NOT_FOUND");
  });

  it.each([
    [{ audioId: "abc" }, "audioId"],
    [{ audioId: randomUUID(), resultCount: 0 }, "resultCount"],
    [{ audioId: randomUUID(), resultCount: 21 }, "resultCount"],
    [{ audioId: randomUUID(), resultCount: 2.5 }, "resultCount"],
  ])("rejects %j with a validation error on %s", async (body, field) => {
    const response = await api.createJob(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details[0].field).toBe(field);
  });
});

describe("GET /jobs/:id and /jobs/:id/results", () => {
  it("returns the job status", async () => {
    const { jobId } = (await api.createJob({ audioId, resultCount: 3 })).body;
    const response = await api.get(`/jobs/${jobId}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ jobId, status: "queued", progress: 0, attempts: 0, maxAttempts: 4 });
    expect(response.body.audio.fileName).toBe("sample.mp3");
  });

  it.each(["00000000-0000-4000-8000-000000000000", "not-a-uuid"])("answers 404 for job %s", async (id) => {
    const response = await api.get(`/jobs/${id}`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("JOB_NOT_FOUND");
  });

  it("answers 409 for results while the job is not completed", async () => {
    const { jobId } = (await api.createJob({ audioId })).body;
    const response = await api.get(`/jobs/${jobId}/results`);

    expect(response.status).toBe(409);
    expect(response.body.error.details.status).toBe("queued");
  });

  it("returns the results in order once the job is completed", async () => {
    const { jobId } = await seedJob({ resultCount: 2 });
    await testDb.query(
      `INSERT INTO results (job_id, position, label, text, value, confidence, start_ms, end_ms) VALUES
       ($1, 2, 'music', NULL, -12.5, 0.8, 1000, 2000),
       ($1, 1, 'speech', 'Hello', NULL, 0.95, 0, 1000)`,
      [jobId],
    );
    await testDb.query("UPDATE jobs SET status = 'completed', progress = 100, finished_at = now() WHERE id = $1", [
      jobId,
    ]);

    const response = await api.get(`/jobs/${jobId}/results`);

    expect(response.status).toBe(200);
    expect(response.body.results.map((r: { position: number }) => r.position)).toEqual([1, 2]);
    expect(response.body.results[1]).toMatchObject({ label: "music", text: null, value: -12.5 });
  });
});

describe("GET /jobs", () => {
  it("filters on status, which gives the dead-letter list", async () => {
    const failed = await seedJob({});
    await seedJob({});
    await testDb.query(
      `UPDATE jobs SET status = 'failed', error_code = 'INVALID_AUDIO', finished_at = now() WHERE id = $1`,
      [failed.jobId],
    );

    const response = await api.get("/jobs?status=failed");

    expect(response.status).toBe(200);
    expect(response.body.jobs).toHaveLength(1);
    expect(response.body.jobs[0]).toMatchObject({ jobId: failed.jobId, error: { code: "INVALID_AUDIO" } });
  });
});