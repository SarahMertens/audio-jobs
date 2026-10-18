export const AUDIO_QUEUE_NAME = "audio-processing";

// The queue message only carries the id. The database is the source of truth,
// so the worker always reads the latest job state instead of a stale copy.
export type AudioJobMessage = {
  jobId: string;
};

export const JOB_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];