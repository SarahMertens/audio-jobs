import { useState } from "react";
import { createJob } from "./api/client";
import type { Job } from "./api/types";
import { JobCard } from "./components/JobCard";
import { UploadBox } from "./components/UploadBox";
import { useJobs } from "./hooks/useJobs";
import { useUpload } from "./hooks/useUpload";

// The open file is kept in the address bar (?file=<jobId>), so it stays open after a refresh
// and the link can be shared.
function readOpenJob(): string | null {
  return new URLSearchParams(window.location.search).get("file");
}

function writeOpenJob(jobId: string | null) {
  const url = new URL(window.location.href);
  if (jobId) url.searchParams.set("file", jobId);
  else url.searchParams.delete("file");
  window.history.replaceState(null, "", url);
}

export function App() {
  const { jobs, offline, refresh } = useJobs();
  const [openJobId, setOpenJobId] = useState<string | null>(readOpenJob);
  const [retryError, setRetryError] = useState<string | null>(null);

  function openJob(jobId: string | null) {
    setOpenJobId(jobId);
    writeOpenJob(jobId);
  }

  const upload = useUpload((jobId) => {
    openJob(jobId);
    void refresh();
  });

  async function tryAgain(job: Job) {
    setRetryError(null);
    try {
      // A new job for the same uploaded file; the failed one stays in the list as history.
      const created = await createJob(job.audio.audioId, job.resultCount, crypto.randomUUID());
      openJob(created.jobId);
      void refresh();
    } catch {
      setRetryError("We couldn't start a new try. Check your connection and try again.");
    }
  }

  function goToUpload() {
    const box = document.getElementById("upload");
    box?.scrollIntoView({ behavior: "smooth", block: "center" });
    box?.querySelector("button")?.focus({ preventScroll: true });
  }

  return (
    <div className="mx-auto max-w-[880px] px-5 pb-16">
      <header className="pt-7 pb-6">
        <h1 className="text-3xl font-extrabold tracking-tight">Audio analysis</h1>
        <p className="mt-1 text-muted">
          Upload a recording and we'll split it into parts: what's said, and where there's music or silence.
        </p>
      </header>

      <UploadBox state={upload.state} onFile={upload.start} onRetry={upload.retry} onDismiss={upload.reset} />

      {offline && (
        <p role="status" className="mt-6 rounded-lg bg-slow-soft px-4 py-3 text-slow">
          We can't reach the server right now. We'll keep trying, and your files are safe.
        </p>
      )}
      {retryError && (
        <p role="alert" className="mt-6 rounded-lg bg-bad-soft px-4 py-3 text-bad">
          {retryError}
        </p>
      )}

      <section aria-labelledby="files-title" className="mt-9">
        <h2 id="files-title" className="mb-3 text-lg font-extrabold">
          Your files
        </h2>

        {jobs === null && !offline && <p className="text-muted">Loading your files…</p>}

        {jobs?.length === 0 && (
          <p className="rounded-2xl border border-line p-6 text-muted">
            No files yet. Upload a recording above to get started.
          </p>
        )}

        <div className="grid gap-2.5">
          {jobs?.map((job) => (
            <JobCard
              key={job.jobId}
              job={job}
              open={job.jobId === openJobId}
              onToggle={() => openJob(job.jobId === openJobId ? null : job.jobId)}
              onUploadAnother={goToUpload}
              onTryAgain={() => void tryAgain(job)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}