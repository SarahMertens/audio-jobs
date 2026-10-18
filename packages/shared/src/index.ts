export const AUDIO_QUEUE_NAME = "audio-processing";
export const AUDIO_JOB_NAME = "process-audio";

// The queue message only carries the id. The database is the source of truth,
// so the worker always reads the latest job state instead of a stale copy.
export type AudioJobMessage = {
  jobId: string;
};

// Used by everything that publishes to the queue (API and the worker's recovery sweep).
export const AUDIO_JOB_OPTIONS = {
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export const JOB_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];