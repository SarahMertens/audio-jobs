import type { Job } from "../api/types";
import { failureHelp, formatTime, friendlyStatus, isActive } from "../lib/friendly";
import { StatusIcon } from "./StatusIcon";

type Props = {
  job: Job;
  highlighted: boolean;
  onUploadAnother: () => void;
};

export function JobCard({ job, highlighted, onUploadAnother }: Props) {
  const status = friendlyStatus(job);
  const help = job.status === "failed" ? failureHelp(job) : null;

  return (
    <article
      className={`rounded-2xl border p-4 sm:px-5 ${
        highlighted ? "border-brand-line shadow-[0_2px_8px_rgba(15,60,60,0.07)]" : "border-line"
      }`}
    >
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3.5">
        <StatusIcon tone={status.tone} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{job.audio.fileName}</p>
          {/* aria-live so screen readers hear the status change while the page is open */}
          <p className="text-[15px] text-muted" aria-live="polite">
            <span className="font-semibold text-ink">{status.title}</span>, {status.detail}
          </p>
        </div>
        <span className="hidden text-sm text-muted sm:block">{formatTime(job.createdAt)}</span>
      </div>

      {job.status === "running" && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-soft sm:ml-[50px]">
          <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${job.progress}%` }} />
        </div>
      )}

      {highlighted && isActive(job) && (
        <p className="mt-3 text-muted sm:ml-[50px]">You can close this page. Your results will be here when you come back.</p>
      )}

      {help && (
        <div className="mt-3 flex flex-wrap items-center gap-3.5 text-muted sm:ml-[50px]">
          <span>{help.text}</span>
          {help.action === "upload-another" && (
            <button
              type="button"
              onClick={onUploadAnother}
              className="rounded-lg border-[1.5px] border-brand-line bg-white px-3.5 py-2 font-semibold text-brand"
            >
              Upload another file
            </button>
          )}
        </div>
      )}
    </article>
  );
}