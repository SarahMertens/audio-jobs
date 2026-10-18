import type {
  ApiErrorBody,
  Attempt,
  CreateJobResponse,
  Job,
  ResultsResponse,
  UploadResponse,
} from "./types";

const BASE = "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function toApiError(status: number, body: unknown): ApiError {
  const error = (body as Partial<ApiErrorBody> | null)?.error;
  return new ApiError(status, error?.code ?? "UNKNOWN", error?.message ?? `Request failed (${status})`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(0, "NETWORK", "The server can't be reached");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toApiError(response.status, body);
  return body as T;
}

export function listJobs(limit = 20): Promise<{ jobs: Job[] }> {
  return request(`/jobs?limit=${limit}`);
}

export function getResults(jobId: string): Promise<ResultsResponse> {
  return request(`/jobs/${jobId}/results`);
}

export function getAttempts(jobId: string): Promise<{ jobId: string; attempts: Attempt[] }> {
  return request(`/jobs/${jobId}/attempts`);
}

export function createJob(audioId: string, resultCount: number, idempotencyKey: string) {
  return request<CreateJobResponse>("/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ audioId, resultCount }),
  });
}

// fetch() can't report upload progress, XMLHttpRequest can. For a 50 MB file that matters.
export function uploadAudio(file: File, onProgress: (percent: number) => void): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/uploads`);
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as UploadResponse);
      else reject(toApiError(xhr.status, xhr.response));
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK", "The server can't be reached"));

    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}