import { type DragEvent, useId, useRef, useState } from "react";
import type { UploadState } from "../hooks/useUpload";
import { ACCEPT_ATTRIBUTE, DEFAULT_PARTS, MAX_PARTS, MAX_UPLOAD_MB } from "../lib/limits";

type Props = {
  state: UploadState;
  onFile: (file: File, parts: number) => void;
  onRetry: () => void;
  onDismiss: () => void;
};

const PART_OPTIONS = Array.from({ length: MAX_PARTS }, (_, i) => i + 1);

export function UploadBox({ state, onFile, onRetry, onDismiss }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [parts, setParts] = useState(DEFAULT_PARTS);
  const [dragging, setDragging] = useState(false);
  const partsId = useId();
  const busy = state.phase === "uploading" || state.phase === "starting";

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file && !busy) onFile(file, parts);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files);
  }

  return (
    <section
      id="upload"
      aria-label="Upload a recording"
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`rounded-2xl border-2 border-dashed p-6 transition-colors sm:p-8 ${
        dragging ? "border-brand bg-brand-soft" : "border-brand-line bg-brand-soft/70"
      }`}
    >
      <div className="grid items-center gap-5 sm:grid-cols-[1fr_auto]">
        <div>
          <p className="text-lg font-semibold">{dragging ? "Drop it here" : "Drag your audio file here"}</p>
          <p className="text-muted">MP3, WAV or M4A, up to {MAX_UPLOAD_MB} MB</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 sm:justify-end">
          <label htmlFor={partsId} className="font-semibold">
            Number of parts
          </label>
          <select
            id={partsId}
            value={parts}
            disabled={busy}
            onChange={(e) => setParts(Number(e.target.value))}
            className="rounded-lg border border-line bg-white px-2 py-1.5"
          >
            {PART_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="rounded-lg bg-brand px-4 py-2.5 font-semibold text-white disabled:opacity-60"
          >
            Choose a file
          </button>
          <input
            ref={input}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div aria-live="polite">
        {state.phase === "uploading" && (
          <div className="mt-5">
            <p>
              Uploading <span className="font-semibold">{state.fileName}</span>, {state.progress}%
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
              <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${state.progress}%` }} />
            </div>
          </div>
        )}
        {state.phase === "starting" && (
          <p className="mt-5">
            Starting the analysis of <span className="font-semibold">{state.fileName}</span>…
          </p>
        )}
        {state.phase === "error" && (
          <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 rounded-lg bg-bad-soft px-4 py-3 text-bad">
            <span className="flex-1">
              {state.fileName && <span className="font-semibold">{state.fileName}: </span>}
              {state.message}
            </span>
            {state.canRetry && (
              <button type="button" onClick={onRetry} className="rounded-lg bg-white px-3 py-1.5 font-semibold">
                Try again
              </button>
            )}
            <button type="button" onClick={onDismiss} className="rounded-lg px-3 py-1.5 font-semibold">
              Close
            </button>
          </div>
        )}
      </div>
    </section>
  );
}