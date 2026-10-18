import { GetObjectCommand } from '@aws-sdk/client-s3';
import { retryDelayMs } from '@audio-jobs/shared';
import { UnrecoverableError } from 'bullmq';
import type { PoolClient } from 'pg';
import { db, log, s3 } from './clients.js';
import { config } from './config.js';
import {
  type AudioProcessor,
  ProcessorError,
  type ProcessorResult,
  processorResultSchema,
} from './processor/types.js';

type ClaimedJob = {
  id: string;
  result_count: number;
  attempt_count: number;
  max_attempts: number;
  storage_key: string;
  mime_type: string;
  original_name: string;
  attempt_id: string;
};

// What the queue knows about this delivery of the message.
export type QueueDelivery = {
  // Earlier deliveries of this message that ended in an error.
  attemptsMade: number;
  maxAttempts: number;
};

export type ProcessOutcome = 'completed' | 'skipped';

async function inTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

type ClaimResult =
  | { kind: 'claimed'; job: ClaimedJob }
  | { kind: 'skipped' }
  | { kind: 'exhausted' };

// Moves the job to 'running' and opens a new attempt, in one transaction.
// A job that is unknown, already finished, or out of attempts is not claimed,
// which makes a duplicate queue message harmless.
async function claimJob(jobId: string): Promise<ClaimResult> {
  return inTransaction(async (client) => {
    // A previous attempt that is still 'running' belonged to a worker that crashed.
    await client.query(
      `UPDATE job_attempts
       SET status = 'failed', error_code = 'WORKER_LOST',
           error_message = 'The worker stopped before finishing', retryable = true,
           finished_at = now()
       WHERE job_id = $1 AND status = 'running'`,
      [jobId],
    );

    const claimed = await client.query<Omit<ClaimedJob, 'attempt_id'>>(
      `WITH claimed AS (
         UPDATE jobs
         SET status = 'running',
             attempt_count = attempt_count + 1,
             progress = 0,
             started_at = COALESCE(started_at, now()),
             error_code = NULL,
             error_message = NULL,
             next_retry_at = NULL
         WHERE id = $1
           AND status IN ('queued', 'running')
           AND attempt_count < max_attempts
         RETURNING id, audio_file_id, result_count, attempt_count, max_attempts
       )
       SELECT c.id, c.result_count, c.attempt_count, c.max_attempts,
              a.storage_key, a.mime_type, a.original_name
       FROM claimed c JOIN audio_files a ON a.id = c.audio_file_id`,
      [jobId],
    );
    const job = claimed.rows[0];

    if (job) {
      const attempt = await client.query<{ id: string }>(
        'INSERT INTO job_attempts (job_id, attempt_number) VALUES ($1, $2) RETURNING id',
        [jobId, job.attempt_count],
      );
      return {
        kind: 'claimed',
        job: { ...job, attempt_id: attempt.rows[0]!.id },
      };
    }

    // Still open but out of attempts: this happens when workers keep crashing on the job.
    const exhausted = await client.query(
      `UPDATE jobs
       SET status = 'failed', error_code = 'ATTEMPTS_EXHAUSTED',
           error_message = 'The job was stopped after too many attempts',
           finished_at = now(), next_retry_at = NULL
       WHERE id = $1 AND status IN ('queued', 'running')`,
      [jobId],
    );
    return exhausted.rowCount ? { kind: 'exhausted' } : { kind: 'skipped' };
  });
}

async function downloadAudio(storageKey: string): Promise<Buffer> {
  try {
    const object = await s3.send(
      new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: storageKey }),
    );
    return Buffer.from(await object.Body!.transformToByteArray());
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') {
      throw new ProcessorError(
        'AUDIO_MISSING',
        'The audio file is no longer in storage',
        false,
      );
    }
    throw new ProcessorError(
      'STORAGE_UNAVAILABLE',
      'The audio file could not be downloaded',
      true,
    );
  }
}

function validateResults(
  results: unknown,
  expectedCount: number,
): ProcessorResult[] {
  if (!Array.isArray(results) || results.length !== expectedCount) {
    throw new ProcessorError(
      'INVALID_PROCESSOR_OUTPUT',
      `The processor returned ${Array.isArray(results) ? results.length : 'no'} results instead of ${expectedCount}`,
      false,
    );
  }
  return results.map((result) => {
    const parsed = processorResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new ProcessorError(
        'INVALID_PROCESSOR_OUTPUT',
        'The processor returned an invalid result',
        false,
      );
    }
    return parsed.data;
  });
}

async function saveResults(
  job: ClaimedJob,
  results: ProcessorResult[],
): Promise<void> {
  await inTransaction(async (client) => {
    // Results and the 'completed' status are written together: the API can never
    // show a completed job with missing or extra results.
    await client.query('DELETE FROM results WHERE job_id = $1', [job.id]);
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
      throw new Error('job is no longer running');
    }

    await client.query(
      "UPDATE job_attempts SET status = 'succeeded', finished_at = now() WHERE id = $1",
      [job.attempt_id],
    );
  });
}

function toSafeError(err: unknown): ProcessorError {
  if (err instanceof ProcessorError) return err;
  // Unknown errors may contain internal details, so the stored message stays generic.
  // They are treated as transient: the next attempt might well succeed.
  return new ProcessorError(
    'INTERNAL_ERROR',
    'Unexpected error while processing the audio',
    true,
  );
}

async function closeAttempt(
  client: PoolClient,
  job: ClaimedJob,
  error: ProcessorError,
) {
  await client.query(
    `UPDATE job_attempts
     SET status = 'failed', error_code = $2, error_message = $3, retryable = $4, finished_at = now()
     WHERE id = $1`,
    [job.attempt_id, error.code, error.message, error.retryable],
  );
}

// Back to 'queued': the queue delivers the message again after the backoff delay.
async function markRetrying(
  job: ClaimedJob,
  error: ProcessorError,
  delayMs: number,
) {
  await inTransaction(async (client) => {
    await closeAttempt(client, job, error);
    await client.query(
      `UPDATE jobs
       SET status = 'queued', progress = 0, error_code = $2, error_message = $3,
           next_retry_at = now() + $4 * interval '1 millisecond'
       WHERE id = $1 AND status = 'running'`,
      [job.id, error.code, error.message, delayMs],
    );
  });
}

async function markFailed(job: ClaimedJob, error: ProcessorError) {
  await inTransaction(async (client) => {
    await closeAttempt(client, job, error);
    await client.query(
      `UPDATE jobs
       SET status = 'failed', error_code = $2, error_message = $3,
           finished_at = now(), next_retry_at = NULL
       WHERE id = $1 AND status = 'running'`,
      [job.id, error.code, error.message],
    );
  });
}

export async function processJob(
  jobId: string,
  processor: AudioProcessor,
  delivery: QueueDelivery,
): Promise<ProcessOutcome> {
  const claim = await claimJob(jobId);

  if (claim.kind === 'skipped') {
    log.info({ jobId }, 'job skipped: not found or already finished');
    return 'skipped';
  }
  if (claim.kind === 'exhausted') {
    log.error({ jobId }, 'job failed: no attempts left');
    throw new UnrecoverableError('ATTEMPTS_EXHAUSTED');
  }

  const { job } = claim;
  const jobLog = log.child({ jobId, attempt: job.attempt_count });
  jobLog.info('job started');

  try {
    const audio = await downloadAudio(job.storage_key);

    const results = await processor.process({
      audio,
      mimeType: job.mime_type,
      fileName: job.original_name,
      attempt: job.attempt_count,
      resultCount: job.result_count,
      onProgress: async (percent) => {
        await db.query(
          "UPDATE jobs SET progress = $2 WHERE id = $1 AND status = 'running'",
          [job.id, Math.min(99, Math.max(0, Math.round(percent)))],
        );
      },
    });

    await saveResults(job, validateResults(results, job.result_count));
    jobLog.info({ resultCount: job.result_count }, 'job completed');
    return 'completed';
  } catch (err) {
    const error = toSafeError(err);

    // The database decides how many attempts a job gets; the queue must also still allow one.
    const canRetry =
      error.retryable &&
      job.attempt_count < job.max_attempts &&
      delivery.attemptsMade + 1 < delivery.maxAttempts;

    if (canRetry) {
      const delayMs = retryDelayMs(delivery.attemptsMade + 1);
      await markRetrying(job, error, delayMs);
      jobLog.warn(
        { code: error.code, delayMs, err },
        'job attempt failed, will retry',
      );
      // Throwing a normal error tells the queue to schedule the next attempt.
      throw new Error(`${error.code}: ${error.message}`);
    }

    await markFailed(job, error);
    jobLog.error(
      { code: error.code, retryable: error.retryable, err },
      'job failed',
    );
    // UnrecoverableError stops the queue from retrying and moves the message to the failed list.
    throw new UnrecoverableError(`${error.code}: ${error.message}`);
  }
}
