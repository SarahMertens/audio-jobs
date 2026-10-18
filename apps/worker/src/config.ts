import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  // How long the mock processor pretends to work on one file.
  MOCK_PROCESSING_MS: z.coerce.number().int().min(0).default(4000),
  // Simulated processor failures for demos and tests. Never enable this in production.
  FAILURE_INJECTION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  MOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),

  RECOVERY_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
  // A queued job older than this was probably never published (e.g. Redis was down).
  STALE_QUEUED_SECONDS: z.coerce.number().int().min(10).default(60),
  // A running job without any progress update for this long lost its worker.
  STALE_RUNNING_SECONDS: z.coerce.number().int().min(30).default(300),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const config = parsed.data;
