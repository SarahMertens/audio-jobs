import type { JobStatus } from "@audio-jobs/shared";

// These types mirror the JSON the API sends (see apps/api/src/jobs/job-view.ts).

export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export type UploadResponse = {
  audioId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type CreateJobResponse = {
  jobId: string;
  status: JobStatus;
  statusUrl: string;
};

export type Job = {
  jobId: string;
  status: JobStatus;
  progress: number;
  resultCount: number;
  attempts: number;
  maxAttempts: number;
  error: { code: string | null; message: string | null } | null;
  retry: {
    lastError: { code: string | null; message: string | null };
    nextRetryAt: string | null;
  } | null;
  audio: { audioId: string; fileName: string };
  statusUrl: string;
  resultsUrl: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type Result = {
  position: number;
  label: string;
  text: string | null;
  value: number | null;
  confidence: number;
  startMs: number | null;
  endMs: number | null;
};

export type ResultsResponse = {
  jobId: string;
  resultCount: number;
  results: Result[];
};

export type Attempt = {
  attempt: number;
  status: "running" | "succeeded" | "failed";
  error: { code: string; message: string | null; retryable: boolean | null } | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
};