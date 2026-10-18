import {
  AUDIO_JOB_NAME,
  AUDIO_JOB_OPTIONS,
  AUDIO_QUEUE_NAME,
  type AudioJobMessage,
} from '@audio-jobs/shared';
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
    AUDIO_JOB_NAME,
    { jobId },
    { jobId, ...AUDIO_JOB_OPTIONS },
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
