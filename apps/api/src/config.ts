import { z } from "zod";

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const config = parsed.data;