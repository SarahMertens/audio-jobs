import type { Tone } from "../lib/friendly";

const STYLE: Record<Tone, { className: string; symbol: string }> = {
  ok: { className: "bg-ok-soft text-ok", symbol: "✓" },
  work: { className: "bg-brand-soft text-brand", symbol: "…" },
  wait: { className: "bg-brand-soft text-brand", symbol: "…" },
  slow: { className: "bg-slow-soft text-slow", symbol: "↻" },
  bad: { className: "bg-bad-soft text-bad", symbol: "!" },
};

export function StatusIcon({ tone }: { tone: Tone }) {
  const { className, symbol } = STYLE[tone];
  return (
    <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full font-extrabold ${className}`}>
      {symbol}
    </span>
  );
}