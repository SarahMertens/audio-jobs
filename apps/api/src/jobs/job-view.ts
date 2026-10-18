import type { JobStatus } from '@audio-jobs/shared';

export type JobRow = {
  id: string;
  audio_file_id: string;
  status: JobStatus;
  result_count: number;
  idempotency_key: string | null;
  progress: number;
  attempt_count: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  original_name: string;
};

export const JOB_COLUMNS = `
  j.id, j.audio_file_id, j.status, j.result_count, j.idempotency_key, j.progress,
  j.attempt_count, j.max_attempts, j.error_code, j.error_message,
  j.created_at, j.updated_at, j.started_at, j.finished_at,
  a.original_name`;

export function statusUrl(jobId: string) {
  return `/jobs/${jobId}`;
}

export function toJobResponse(row: JobRow) {
  return {
    jobId: row.id,
    status: row.status,
    progress: row.progress,
    resultCount: row.result_count,
    attempts: row.attempt_count,
    maxAttempts: row.max_attempts,
    error:
      row.status === 'failed'
        ? { code: row.error_code, message: row.error_message }
        : null,
    audio: { audioId: row.audio_file_id, fileName: row.original_name },
    statusUrl: statusUrl(row.id),
    resultsUrl: row.status === 'completed' ? `/jobs/${row.id}/results` : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

export type ResultRow = {
  position: number;
  label: string;
  text: string | null;
  value: string | null;
  confidence: number;
  start_ms: number | null;
  end_ms: number | null;
};

export function toResultResponse(row: ResultRow) {
  return {
    position: row.position,
    label: row.label,
    text: row.text,
    // pg returns numeric columns as strings to avoid precision loss.
    value: row.value === null ? null : Number(row.value),
    confidence: row.confidence,
    startMs: row.start_ms,
    endMs: row.end_ms,
  };
}
