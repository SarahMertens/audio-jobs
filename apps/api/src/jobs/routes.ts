import { JOB_STATUSES } from "@audio-jobs/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../clients.js";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { publishJob } from "../queue.js";
import {
  type AttemptRow,
  JOB_COLUMNS,
  type JobRow,
  type ResultRow,
  statusUrl,
  toAttemptResponse,
  toJobResponse,
  toResultResponse,
} from "./job-view.js";

const createJobBody = z.object({
  audioId: z.uuid(),
  resultCount: z
    .number()
    .int()
    .min(1)
    .max(config.MAX_RESULT_COUNT)
    .default(config.DEFAULT_RESULT_COUNT),
});

const idempotencyKeyHeader = z.string().trim().min(1).max(200).optional();

const jobIdParams = z.object({ id: z.uuid() });

const listJobsQuery = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function validationError(error: z.ZodError): AppError {
  const details = error.issues.map((issue) => ({
    field: issue.path.join(".") || null,
    message: issue.message,
  }));
  return new AppError(400, "VALIDATION_ERROR", "The request is not valid", details);
}

async function findJobFromParams(params: unknown): Promise<JobRow> {
  const parsed = jobIdParams.safeParse(params);
  // An id that isn't a uuid can't exist, so answer the same way as for an unknown id.
  const job = parsed.success ? await findJob(parsed.data.id) : undefined;
  if (!job) throw new AppError(404, "JOB_NOT_FOUND", "No job with this id");
  return job;
}

async function findJob(jobId: string): Promise<JobRow | undefined> {
  const result = await db.query<JobRow>(
    `SELECT ${JOB_COLUMNS}
     FROM jobs j JOIN audio_files a ON a.id = j.audio_file_id
     WHERE j.id = $1`,
    [jobId],
  );
  return result.rows[0];
}

export async function jobRoutes(app: FastifyInstance) {
  app.post("/jobs", async (request, reply) => {
    const body = createJobBody.safeParse(request.body ?? {});
    if (!body.success) throw validationError(body.error);

    const key = idempotencyKeyHeader.safeParse(request.headers["idempotency-key"]);
    if (!key.success) throw validationError(key.error);

    const { audioId, resultCount } = body.data;
    const idempotencyKey = key.data ?? null;

    let jobId: string;
    let replayed = false;

    try {
      // ON CONFLICT makes two identical requests at the same moment safe:
      // the unique index decides which one wins, the other gets no row back.
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO jobs (audio_file_id, result_count, idempotency_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [audioId, resultCount, idempotencyKey],
      );

      if (inserted.rows[0]) {
        jobId = inserted.rows[0].id;
      } else {
        const existing = await db.query<{ id: string; audio_file_id: string; result_count: number }>(
          "SELECT id, audio_file_id, result_count FROM jobs WHERE idempotency_key = $1",
          [idempotencyKey],
        );
        const job = existing.rows[0]!;
        if (job.audio_file_id !== audioId || job.result_count !== resultCount) {
          throw new AppError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "This Idempotency-Key was already used for a different request",
          );
        }
        jobId = job.id;
        replayed = true;
      }
    } catch (err) {
      if ((err as { code?: string }).code === "23503") {
        throw new AppError(404, "AUDIO_NOT_FOUND", "No uploaded audio file with this audioId");
      }
      throw err;
    }

    const job = (await findJob(jobId))!;

    request.log.info({ jobId: job.id, replayed }, replayed ? "job request replayed" : "job created");

    if (job.status === "queued") {
      try {
        await publishJob(job.id, request.id);
      } catch (err) {
        // The job is safely stored as 'queued'. The worker's recovery sweep re-publishes
        // queued jobs that were never picked up, so the client still gets a valid job.
        request.log.warn({ err, jobId: job.id }, "could not publish job, will be recovered");
      }
    }

    return reply
      .code(202)
      .header("Location", statusUrl(job.id))
      .header("Idempotent-Replayed", String(replayed))
      .send({ jobId: job.id, status: job.status, statusUrl: statusUrl(job.id) });
  });

  // With ?status=failed this is the dead-letter view: jobs that will not be retried anymore.
  app.get("/jobs", async (request) => {
    const query = listJobsQuery.safeParse(request.query);
    if (!query.success) throw validationError(query.error);
    const { status, limit } = query.data;

    const jobs = await db.query<JobRow>(
      `SELECT ${JOB_COLUMNS}
       FROM jobs j JOIN audio_files a ON a.id = j.audio_file_id
       WHERE $1::text IS NULL OR j.status = $1
       ORDER BY j.created_at DESC
       LIMIT $2`,
      [status ?? null, limit],
    );

    return { jobs: jobs.rows.map(toJobResponse) };
  });

  app.get("/jobs/:id/attempts", async (request) => {
    const job = await findJobFromParams(request.params);
    const attempts = await db.query<AttemptRow>(
      `SELECT attempt_number, status, error_code, error_message, retryable, started_at, finished_at
       FROM job_attempts WHERE job_id = $1 ORDER BY attempt_number`,
      [job.id],
    );
    return { jobId: job.id, attempts: attempts.rows.map(toAttemptResponse) };
  });

  app.get("/jobs/:id", async (request) => {
    const job = await findJobFromParams(request.params);
    return toJobResponse(job);
  });

  app.get("/jobs/:id/results", async (request) => {
    const job = await findJobFromParams(request.params);

    if (job.status !== "completed") {
      throw new AppError(409, "JOB_NOT_COMPLETED", `The job is ${job.status}, results are not available`, {
        status: job.status,
        statusUrl: statusUrl(job.id),
      });
    }

    const results = await db.query<ResultRow>(
      `SELECT position, label, text, value, confidence, start_ms, end_ms
       FROM results WHERE job_id = $1 ORDER BY position`,
      [job.id],
    );

    return {
      jobId: job.id,
      resultCount: job.result_count,
      results: results.rows.map(toResultResponse),
    };
  });
}