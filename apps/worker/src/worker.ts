import { AUDIO_QUEUE_NAME, type AudioJobMessage } from '@audio-jobs/shared';
import { Worker } from 'bullmq';
import { log } from './clients.js';
import { config } from './config.js';
import { processJob } from './process-job.js';
import type { AudioProcessor } from './processor/types.js';

// Connects a processor to the queue. Used by main.ts and by the integration tests.
export function createWorker(
  processor: AudioProcessor,
  concurrency = config.WORKER_CONCURRENCY,
) {
  const worker = new Worker<AudioJobMessage>(
    AUDIO_QUEUE_NAME,
    (job) =>
      processJob(job.data.jobId, processor, {
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 1,
        requestId: job.data.requestId,
      }),
    {
      connection: { url: config.REDIS_URL },
      prefix: config.QUEUE_PREFIX,
      concurrency,
    },
  );

  worker.on('error', (err) => log.error({ err: err.message }, 'worker error'));
  worker.on('failed', (job, err) => {
    const final =
      err.name === 'UnrecoverableError' ||
      (job?.attemptsMade ?? 0) >= (job?.opts.attempts ?? 1);
    if (final) {
      log.error(
        { jobId: job?.id, reason: err.message },
        'job moved to the dead-letter list',
      );
    }
  });

  return worker;
}
