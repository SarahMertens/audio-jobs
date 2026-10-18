import { AUDIO_QUEUE_NAME, type AudioJobMessage } from '@audio-jobs/shared';
import { Queue } from 'bullmq';
import { config } from './config.js';

const PUBLISH_TIMEOUT_MS = 2000;

export const audioQueue = new Queue<AudioJobMessage>(AUDIO_QUEUE_NAME, {
  connection: {
    url: config.REDIS_URL,
    enableOfflineQueue: false,
  },
});

audioQueue.on('error', (err) => {
  console.warn(`queue: ${err.message}`);
});

export async function publishJob(jobId: string): Promise<void> {
  const add = audioQueue.add(
    'process-audio',
    { jobId },
    {
      jobId,
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  );

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('queue publish timed out')),
      PUBLISH_TIMEOUT_MS,
    );
  });

  try {
    await Promise.race([add, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
