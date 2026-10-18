import type { Result } from "../api/types";
import { isUnsure, partKind, timeRange } from "../lib/results";

export function ResultList({ results }: { results: Result[] }) {
  return (
    <ol className="border-t border-line">
      {results.map((r) => (
        <li key={r.position} className="grid gap-x-4 border-b border-line py-3 last:border-b-0 sm:grid-cols-[110px_1fr]">
          <span className="text-[15px] text-muted tabular-nums">{timeRange(r)}</span>
          <div>
            <span className="text-[13px] font-semibold text-brand">{partKind(r)}</span>
            {r.text ? <p>{r.text}</p> : <p className="text-muted">No words in this part</p>}
            {isUnsure(r) && <p className="text-[13px] text-slow">We're not fully sure about this part</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}