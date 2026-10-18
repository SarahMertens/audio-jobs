import { useRef, useState } from "react";
import { createJob, uploadAudio } from "../api/client";
import { checkFile, uploadProblem } from "../lib/friendly";

export type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; fileName: string; progress: number }
  | { phase: "starting"; fileName: string }
  | { phase: "error"; fileName: string | null; message: string; canRetry: boolean };

// What has been done so far for the current file, so "Try again" continues where it stopped.
type Pending = { file: File; parts: number; idempotencyKey: string; audioId?: string };

export function useUpload(onJobCreated: (jobId: string) => void) {
  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const pending = useRef<Pending | null>(null);

  async function run(p: Pending) {
    pending.current = p;
    try {
      if (!p.audioId) {
        setState({ phase: "uploading", fileName: p.file.name, progress: 0 });
        const uploaded = await uploadAudio(p.file, (progress) =>
          setState({ phase: "uploading", fileName: p.file.name, progress }),
        );
        p.audioId = uploaded.audioId;
      }
      setState({ phase: "starting", fileName: p.file.name });
      // Same key on a retry: if the first request did reach the API, no second job is made.
      const job = await createJob(p.audioId, p.parts, p.idempotencyKey);
      pending.current = null;
      setState({ phase: "idle" });
      onJobCreated(job.jobId);
    } catch (err) {
      setState({ phase: "error", fileName: p.file.name, ...uploadProblem(err) });
    }
  }

  function start(file: File, parts: number) {
    const problem = checkFile(file);
    if (problem) {
      setState({ phase: "error", fileName: file.name, message: problem, canRetry: false });
      return;
    }
    void run({ file, parts, idempotencyKey: crypto.randomUUID() });
  }

  function retry() {
    if (pending.current) void run(pending.current);
  }

  function reset() {
    pending.current = null;
    setState({ phase: "idle" });
  }

  return { state, start, retry, reset };
}