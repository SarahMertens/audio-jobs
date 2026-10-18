import { useState } from "react";
import { getAttempts } from "../api/client";
import type { Attempt, Job } from "../api/types";

// Closed by default: normal users don't need this, but it shows the retry path in a demo.
export function TechnicalDetails({ job }: { job: Job }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function loadAttempts() {
    try {
      setAttempts((await getAttempts(job.jobId)).attempts);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  return (
    <details
      className="mt-3 text-sm text-muted"
      onToggle={(e) => {
        if (e.currentTarget.open) void loadAttempts();
      }}
    >
      <summary className="w-fit cursor-pointer select-none">Technical details</summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt>Job ID</dt>
        <dd className="break-all">{job.jobId}</dd>
        <dt>Status</dt>
        <dd>{job.status}</dd>
        <dt>Attempts</dt>
        <dd>
          {job.attempts} of {job.maxAttempts}
        </dd>
        {job.error && (
          <>
            <dt>Error</dt>
            <dd>{job.error.code}</dd>
          </>
        )}
      </dl>
      {failed && <p className="mt-2">The attempt history couldn't be loaded.</p>}
      {attempts && attempts.length > 0 && (
        <ol className="mt-2 list-inside list-decimal">
          {attempts.map((a) => (
            <li key={a.attempt}>
              {a.status}
              {a.error && `: ${a.error.code} (${a.error.retryable ? "temporary" : "permanent"} problem)`}
              {a.durationMs !== null && `, ${(a.durationMs / 1000).toFixed(1)} s`}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}