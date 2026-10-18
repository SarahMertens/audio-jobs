import { AUDIO_JOB_NAME, AUDIO_JOB_OPTIONS, type AudioJobMessage } from "@audio-jobs/shared";
import type { Queue } from "bullmq";
import { db, log } from "./clients.js";
import { config } from "./config.js";

const STILL_IN_QUEUE = new Set(["waiting", "active", "delayed", "prioritized", "waiting-children"]);

// Finds jobs that the database says are waiting or running, but that nobody is working on:
// - queued too long: the API stored the job but could not publish it (Redis was down)
// - running without progress: the worker crashed and the queue gave up on the job
export async function recoverStuckJobs(queue: Queue<AudioJobMessage>): Promise<number> {
  const stuck = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM jobs
     WHERE (status = 'queued' AND updated_at < now() - make_interval(secs => $1))
        OR (status = 'running' AND updated_at < now() - make_interval(secs => $2))
     ORDER BY created_at
     LIMIT 100`,
    [config.STALE_QUEUED_SECONDS, config.STALE_RUNNING_SECONDS],
  );

  let recovered = 0;
  for (const { id, status } of stuck.rows) {
    try {
      const existing = await queue.getJob(id);
      if (existing) {
        const state = await existing.getState();
        if (STILL_IN_QUEUE.has(state)) continue;
        // A finished queue entry with the same id would block a new one.
        await existing.remove();
      }
      await queue.add(AUDIO_JOB_NAME, { jobId: id }, { jobId: id, ...AUDIO_JOB_OPTIONS });
      recovered++;
      log.warn({ jobId: id, status }, "recovered stuck job");
    } catch (err) {
      log.error({ jobId: id, err }, "could not recover job");
    }
  }
  return recovered;
}