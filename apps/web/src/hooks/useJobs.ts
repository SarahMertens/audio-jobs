import { useCallback, useEffect, useRef, useState } from "react";
import { listJobs } from "../api/client";
import type { Job } from "../api/types";
import { isActive } from "../lib/friendly";

const FAST_POLL_MS = 1500;
const SLOW_POLL_MS = 15000;
const OFFLINE_POLL_MS = 3000;

// Loads the job list and keeps it fresh by polling.
// Polls fast while something is waiting or running, slowly otherwise,
// a bit faster again while the server can't be reached, and not at all while the tab is hidden.
export function useJobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [offline, setOffline] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const jobsRef = useRef<Job[] | null>(null);
  const stopped = useRef(false);

  const load = useCallback(async () => {
    window.clearTimeout(timer.current);
    let reachable = true;
    try {
      const { jobs } = await listJobs();
      jobsRef.current = jobs;
      setJobs(jobs);
    } catch {
      reachable = false;
    }
    setOffline(!reachable);
    // Two loads can overlap (a refresh during a poll): only one may schedule the next poll.
    window.clearTimeout(timer.current);
    if (stopped.current || document.visibilityState === "hidden") return;
    const busy = jobsRef.current?.some(isActive) ?? false;
    const delay = !reachable ? OFFLINE_POLL_MS : busy ? FAST_POLL_MS : SLOW_POLL_MS;
    timer.current = window.setTimeout(load, delay);
  }, []);

  useEffect(() => {
    stopped.current = false;
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped.current = true;
      window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return { jobs, offline, refresh: load };
}