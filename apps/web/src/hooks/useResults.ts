import { useCallback, useEffect, useState } from "react";
import { getResults } from "../api/client";
import type { Result } from "../api/types";

// Results never change once a job is completed, so they are fetched once per job.
const cache = new Map<string, Result[]>();

type State = { phase: "idle" | "loading" | "error" } | { phase: "ready"; results: Result[] };

export function useResults(jobId: string, enabled: boolean) {
  const cached = cache.get(jobId);
  const [state, setState] = useState<State>(cached ? { phase: "ready", results: cached } : { phase: "idle" });

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const { results } = await getResults(jobId);
      cache.set(jobId, results);
      setState({ phase: "ready", results });
    } catch {
      setState({ phase: "error" });
    }
  }, [jobId]);

  useEffect(() => {
    if (enabled && state.phase === "idle") void load();
  }, [enabled, state.phase, load]);

  return { state, reload: load };
}