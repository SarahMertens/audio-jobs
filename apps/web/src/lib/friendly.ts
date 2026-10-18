import { ApiError } from "../api/client";
import type { Job } from "../api/types";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_MB } from "./limits";

// Every technical state is translated to plain words here, in one place.

export type Tone = "wait" | "work" | "slow" | "ok" | "bad";

export type FriendlyStatus = { tone: Tone; title: string; detail: string };

export function friendlyStatus(job: Job): FriendlyStatus {
  switch (job.status) {
    case "completed":
      return { tone: "ok", title: "Ready", detail: `${job.resultCount} parts found` };
    case "running":
      return { tone: "work", title: "Analysing your audio", detail: `${job.progress}% done` };
    case "queued":
      return job.retry
        ? { tone: "slow", title: "Taking a little longer", detail: "we're trying again automatically" }
        : { tone: "wait", title: "Waiting to start", detail: "this usually takes a few seconds" };
    case "failed":
      return job.error?.code === "INVALID_AUDIO" || job.error?.code === "AUDIO_MISSING"
        ? { tone: "bad", title: "This file can't be read", detail: "it may be damaged or not a real audio file" }
        : { tone: "bad", title: "We couldn't finish this file", detail: "something went wrong on our side" };
  }
}

export type FailureHelp = { text: string; action: "upload-another" | "try-again" };

export function failureHelp(job: Job): FailureHelp {
  if (job.error?.code === "INVALID_AUDIO" || job.error?.code === "AUDIO_MISSING") {
    return { text: "Try exporting the recording again, or upload a different file.", action: "upload-another" };
  }
  return { text: "Your file is safe. You can try again now or later.", action: "try-again" };
}

export function isActive(job: Job): boolean {
  return job.status === "queued" || job.status === "running";
}

// Returns a message when the file is clearly wrong, before wasting time on the upload.
export function checkFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return "Choose an MP3, WAV or M4A file.";
  }
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `This file is larger than ${MAX_UPLOAD_MB} MB. Try a shorter or compressed recording.`;
  }
  return null;
}

export type UploadProblem = { message: string; canRetry: boolean };

export function uploadProblem(err: unknown): UploadProblem {
  const code = err instanceof ApiError ? err.code : "UNKNOWN";
  switch (code) {
    case "UNSUPPORTED_FORMAT":
      return { message: "This doesn't look like an MP3, WAV or M4A file. Check the file and try again.", canRetry: false };
    case "FILE_TOO_LARGE":
      return { message: `This file is larger than ${MAX_UPLOAD_MB} MB. Try a shorter or compressed recording.`, canRetry: false };
    case "EMPTY_FILE":
      return { message: "This file is empty.", canRetry: false };
    case "NETWORK":
      return { message: "We can't reach the server. Check your connection and try again.", canRetry: true };
    default:
      return { message: "Something went wrong while uploading. Please try again.", canRetry: true };
  }
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}