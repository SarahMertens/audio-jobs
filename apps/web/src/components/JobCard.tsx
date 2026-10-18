import { useId } from "react";
import type { Job } from "../api/types";
import { useResults } from "../hooks/useResults";
import { failureHelp, formatTime, friendlyStatus, isActive } from "../lib/friendly";
import { downloadText, resultsAsText } from "../lib/results";
import { ResultList } from "./ResultList";
import { StatusIcon } from "./StatusIcon";
import { TechnicalDetails } from "./TechnicalDetails";

type Props = {
  job: Job;
  open: boolean;
  onToggle: () => void;
  onUploadAnother: () => void;
  onTryAgain: () => void;
};

export function JobCard({ job, open, onToggle, onUploadAnother, onTryAgain }: Props) {
  const status = friendlyStatus(job);
  const help = job.status === "failed" ? failureHelp(job) : null;
  const panelId = useId();
  const { state: results, reload } = useResults(job.jobId, open && job.status === "completed");

  return (
    <article
      className={`rounded-2xl border ${
        open ? "border-brand-line shadow-[0_2px_8px_rgba(15,60,60,0.07)]" : "border-line"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3.5 rounded-2xl p-4 text-left sm:px-5"
      >
        <StatusIcon tone={status.tone} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{job.audio.fileName}</span>
          {/* aria-live so screen readers hear the status change while the page is open */}
          <span className="block text-[15px] text-muted" aria-live="polite">
            <span className="font-semibold text-ink">{status.title}</span>, {status.detail}
          </span>
        </span>
        <span className="flex items-center gap-3 text-sm text-muted">
          <span className="hidden sm:inline">{formatTime(job.createdAt)}</span>
          <span aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </span>
      </button>

      {job.status === "running" && (
        <div className="mx-4 -mt-1 mb-4 h-1.5 overflow-hidden rounded-full bg-soft sm:mr-5 sm:ml-[70px]">
          <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${job.progress}%` }} />
        </div>
      )}

      {help && (
        <div
          className={`-mt-1 flex flex-wrap items-center gap-3.5 px-4 text-muted sm:pr-5 sm:pl-[70px] ${open ? "pb-1" : "pb-4"}`}
        >
          <span>{help.text}</span>
          <button
            type="button"
            onClick={help.action === "upload-another" ? onUploadAnother : onTryAgain}
            className="rounded-lg border-[1.5px] border-brand-line bg-white px-3.5 py-2 font-semibold text-brand"
          >
            {help.action === "upload-another" ? "Upload another file" : "Try again"}
          </button>
        </div>
      )}

      {open && (
        <div id={panelId} className="px-4 pb-4 sm:pr-5 sm:pl-[70px]">
          {isActive(job) && (
            <p className="text-muted">You can close this page. Your results will be here when you come back.</p>
          )}

          {job.status === "completed" && results.phase === "loading" && <p className="text-muted">Loading the results…</p>}
          {job.status === "completed" && results.phase === "error" && (
            <p className="text-bad">
              The results couldn't be loaded.{" "}
              <button type="button" onClick={() => void reload()} className="font-semibold underline">
                Try again
              </button>
            </p>
          )}
          {results.phase === "ready" && (
            <>
              <ResultList results={results.results} />
              <button
                type="button"
                onClick={() =>
                  downloadText(
                    `${job.audio.fileName.replace(/\.[^.]+$/, "")}-results.txt`,
                    resultsAsText(job.audio.fileName, results.results),
                  )
                }
                className="mt-3 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white"
              >
                Download results
              </button>
            </>
          )}

          <TechnicalDetails job={job} />
        </div>
      )}
    </article>
  );
}