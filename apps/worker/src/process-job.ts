import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { PoolClient } from "pg";
import { db, log, s3 } from "./clients.js";
import { config } from "./config.js";
import {
  type AudioProcessor,
  ProcessorError,
  type ProcessorResult,
  processorResultSchema,
} from "./processor/types.js";

type ClaimedJob = {
  id: string;
  result_count: number;
  attempt_count: number;
  storage_key: string;
  mime_type: string;
  attempt_id: string;
};

export type ProcessOutcome = "completed" | "failed" | "skipped";

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Moves the job to 'running' and opens a new attempt, in one transaction.
// Returns nothing when the job can't be processed (unknown, already completed or failed),
// which makes a duplicate queue message harmless.
async function claimJob(jobId: string): Promise<ClaimedJob | undefined> {
  return inTransaction(async (client) => {
    const claimed = await client.query<Omit<ClaimedJob, "attempt_id">>(
      `WITH claimed AS (
         UPDATE jobs
         SET status = 'running',
             attempt_count = attempt_count + 1,
             progress = 0,
             started_at = COALESCE(started_at, now()),
             error_code = NULL,
             error_message = NULL
         WHERE id = $1 AND status IN ('queued', 'running')
         RETURNING id, audio_file_id, result_count, attempt_count
       )
       SELECT c.id, c.result_count, c.attempt_count, a.storage_key, a.mime_type
       FROM claimed c JOIN audio_files a ON a.id = c.audio_file_id`,
      [jobId],
    );
    const job = claimed.rows[0];
    if (!job) return undefined;

    // A previous attempt that is still 'running' belonged to a worker that crashed.
    await client.query(
      `UPDATE job_attempts
       SET status = 'failed', error_code = 'WORKER_LOST',
           error_message = 'The worker stopped before finishing', retryable = true,
           finished_at = now()
       WHERE job_id = $1 AND status = 'running'`,
      [jobId],
    );

    const attempt = await client.query<{ id: string }>(
      "INSERT INTO job_attempts (job_id, attempt_number) VALUES ($1, $2) RETURNING id",
      [jobId, job.attempt_count],
    );

    return { ...job, attempt_id: attempt.rows[0]!.id };
  });
}

async function downloadAudio(storageKey: string): Promise<Buffer> {
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: storageKey }));
    return Buffer.from(await object.Body!.transformToByteArray());
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") {
      throw new ProcessorError("AUDIO_MISSING", "The audio file is no longer in storage", false);
    }
    throw new ProcessorError("STORAGE_UNAVAILABLE", "The audio file could not be downloaded", true);
  }
}

function validateResults(results: unknown, expectedCount: number): ProcessorResult[] {
  if (!Array.isArray(results) || results.length !== expectedCount) {
    throw new ProcessorError(
      "INVALID_PROCESSOR_OUTPUT",
      `The processor returned ${Array.isArray(results) ? results.length : "no"} results instead of ${expectedCount}`,
      false,
    );
  }
  return results.map((result) => {
    const parsed = processorResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new ProcessorError("INVALID_PROCESSOR_OUTPUT", "The processor returned an invalid result", false);
    }
    return parsed.data;
  });
}

async function saveResults(job: ClaimedJob, results: ProcessorResult[]): Promise<boolean> {
  return inTransaction(async (client) => {
    // Results and the 'completed' status are written together: the API can never
    // show a completed job with missing or extra results.
    await client.query("DELETE FROM results WHERE job_id = $1", [job.id]);
    await client.query(
      `INSERT INTO results (job_id, position, label, text, value, confidence, start_ms, end_ms)
       SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::numeric[], $6::real[], $7::int[], $8::int[])`,
      [
        job.id,
        results.map((_, i) => i + 1),
        results.map((r) => r.label),
        results.map((r) => r.text),
        results.map((r) => r.value),
        results.map((r) => r.confidence),
        results.map((r) => r.startMs),
        results.map((r) => r.endMs),
      ],
    );

    const updated = await client.query(
      `UPDATE jobs SET status = 'completed', progress = 100, finished_at = now()
       WHERE id = $1 AND status = 'running'`,
      [job.id],
    );
    if (updated.rowCount === 0) {
      // Someone else changed the job meanwhile; throwing rolls the results back.
      throw new Error("job is no longer running");
    }

    await client.query(
      "UPDATE job_attempts SET status = 'succeeded', finished_at = now() WHERE id = $1",
      [job.attempt_id],
    );
    return true;
  });
}

function toSafeError(err: unknown): ProcessorError {
  if (err instanceof ProcessorError) return err;
  return new ProcessorError("INTERNAL_ERROR", "Unexpected error while processing the audio", true);
}

async function markFailed(job: ClaimedJob, error: ProcessorError) {
  await inTransaction(async (client) => {
    await client.query(
      `UPDATE job_attempts
       SET status = 'failed', error_code = $2, error_message = $3, retryable = $4, finished_at = now()
       WHERE id = $1`,
      [job.attempt_id, error.code, error.message, error.retryable],
    );
    await client.query(
      `UPDATE jobs SET status = 'failed', error_code = $2, error_message = $3, finished_at = now()
       WHERE id = $1 AND status = 'running'`,
      [job.id, error.code, error.message],
    );
  });
}

export async function processJob(jobId: string, processor: AudioProcessor): Promise<ProcessOutcome> {
  const job = await claimJob(jobId);
  if (!job) {
    log.info({ jobId }, "job skipped: not found or already finished");
    return "skipped";
  }

  const jobLog = log.child({ jobId, attempt: job.attempt_count });
  jobLog.info("job started");

  try {
    const audio = await downloadAudio(job.storage_key);

    const results = await processor.process({
      audio,
      mimeType: job.mime_type,
      resultCount: job.result_count,
      onProgress: async (percent) => {
        await db.query("UPDATE jobs SET progress = $2 WHERE id = $1 AND status = 'running'", [
          job.id,
          Math.min(99, Math.max(0, Math.round(percent))),
        ]);
      },
    });

    await saveResults(job, validateResults(results, job.result_count));
    jobLog.info({ resultCount: job.result_count }, "job completed");
    return "completed";
  } catch (err) {
    const error = toSafeError(err);
    jobLog.warn({ code: error.code, retryable: error.retryable, err }, "job attempt failed");
    await markFailed(job, error);
    return "failed";
  }
}