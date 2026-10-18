import { AUDIO_QUEUE_NAME, type AudioJobMessage } from "@audio-jobs/shared";
import { Queue } from "bullmq";
import { db, log, s3 } from "./clients.js";
import { config } from "./config.js";
import { FailureInjectingProcessor } from "./processor/failure-injection.js";
import { MockProcessor } from "./processor/mock-processor.js";
import type { AudioProcessor } from "./processor/types.js";
import { recoverStuckJobs } from "./recovery.js";
import { createWorker } from "./worker.js";

const mock = new MockProcessor(config.MOCK_PROCESSING_MS);
const processor: AudioProcessor = config.FAILURE_INJECTION
  ? new FailureInjectingProcessor(mock, config.MOCK_FAILURE_RATE)
  : mock;

const worker = createWorker(processor);

// The worker also publishes, but only for the recovery sweep.
const queue = new Queue<AudioJobMessage>(AUDIO_QUEUE_NAME, {
  connection: { url: config.REDIS_URL },
  prefix: config.QUEUE_PREFIX,
});
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