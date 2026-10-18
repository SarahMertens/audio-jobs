export const AUDIO_QUEUE_NAME = "audio-processing";
export const AUDIO_JOB_NAME = "process-audio";

// The queue message only carries the id. The database is the source of truth,
// so the worker always reads the latest job state instead of a stale copy.
export type AudioJobMessage = {
  jobId: string;
};

// 1 first try + 3 retries. Must match the default of jobs.max_attempts in the database.
export const MAX_ATTEMPTS = 4;
// Waits between attempts: 2 s, 4 s, 8 s.
export const RETRY_BASE_DELAY_MS = 2000;

export function retryDelayMs(failedAttempts: number): number {
  return RETRY_BASE_DELAY_MS * 2 ** (failedAttempts - 1);
}

// Used by everything that publishes to the queue (API and the worker's recovery sweep).
export const AUDIO_JOB_OPTIONS = {
  attempts: MAX_ATTEMPTS,
  backoff: { type: "exponential", delay: RETRY_BASE_DELAY_MS },
  removeOnComplete: { count: 1000 },
  // Failed queue entries are the dead-letter list; keep enough of them to inspect.
  removeOnFail: { count: 5000 },
};

export const JOB_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];