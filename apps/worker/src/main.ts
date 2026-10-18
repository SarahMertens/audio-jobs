import { AUDIO_QUEUE_NAME, type AudioJobMessage } from "@audio-jobs/shared";
import { Queue, Worker } from "bullmq";
import { db, log, s3 } from "./clients.js";
import { config } from "./config.js";
import { processJob } from "./process-job.js";
import { MockProcessor } from "./processor/mock-processor.js";
import { recoverStuckJobs } from "./recovery.js";

const processor = new MockProcessor(config.MOCK_PROCESSING_MS);
const connection = { url: config.REDIS_URL };

const worker = new Worker<AudioJobMessage>(
  AUDIO_QUEUE_NAME,
  (job) => processJob(job.data.jobId, processor),
  { connection, concurrency: config.WORKER_CONCURRENCY },
);

worker.on("error", (err) => log.error({ err: err.message }, "worker error"));
worker.on("failed", (job, err) => log.error({ jobId: job?.id, err: err.message }, "queue job failed"));

// The worker also publishes, but only for the recovery sweep.
const queue = new Queue<AudioJobMessage>(AUDIO_QUEUE_NAME, { connection });
queue.on("error", (err) => log.error({ err: err.message }, "queue error"));

let sweeping = false;
async function sweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    await recoverStuckJobs(queue);
  } catch (err) {
    log.error({ err }, "recovery sweep failed");
  } finally {
    sweeping = false;
  }
}

const sweepTimer = setInterval(() => void sweep(), config.RECOVERY_INTERVAL_SECONDS * 1000);
void sweep();

log.info(
  { processor: processor.name, concurrency: config.WORKER_CONCURRENCY },
  "worker started, waiting for jobs",
);

async function shutdown(signal: string) {
  log.info({ signal }, "shutting down, finishing active jobs first");
  clearInterval(sweepTimer);
  // close() waits until the jobs that are running now are finished.
  await worker.close();
  await queue.close();
  await db.end();
  s3.destroy();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));