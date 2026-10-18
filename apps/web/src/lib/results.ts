import type { Result } from "../api/types";

const KIND: Record<string, string> = {
  speech: "Speech",
  music: "Music",
  noise: "Background noise",
  silence: "Silence",
};

// Below this, we tell the user we're not sure about the text.
const UNSURE_BELOW = 0.9;

export function partKind(result: Result): string {
  return KIND[result.label] ?? result.label;
}

export function isUnsure(result: Result): boolean {
  return result.text !== null && result.confidence < UNSURE_BELOW;
}

function clock(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function timeRange(result: Result): string | null {
  if (result.startMs === null) return null;
  return result.endMs === null ? clock(result.startMs) : `${clock(result.startMs)} – ${clock(result.endMs)}`;
}

// Plain text that anyone can open, unlike a CSV that Excel splits differently per country.
export function resultsAsText(fileName: string, results: Result[]): string {
  const lines = [`Results for ${fileName}`, ""];
  for (const r of results) {
    const time = timeRange(r);
    lines.push(`${time ? `${time}  ` : ""}${partKind(r)}`);
    lines.push(r.text ? `  ${r.text}${isUnsure(r) ? " (not fully sure)" : ""}` : "  No words in this part");
    lines.push("");
  }
  return lines.join("\r\n");
}

export function downloadText(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}