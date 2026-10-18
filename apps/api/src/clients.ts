import { S3Client } from "@aws-sdk/client-s3";
import { Redis } from "ioredis";
import pg from "pg";
import { config } from "./config.js";

export const db = new pg.Pool({ connectionString: config.DATABASE_URL });
db.on("error", (err) => {
  console.warn(`postgres: idle connection lost (${err.message})`);
});

export const redis = new Redis(config.REDIS_URL, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});
redis.on("error", (err) => {
  console.warn(`redis: ${err.message}`);
});

export const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  },
});

export async function closeClients(): Promise<void> {
  await Promise.allSettled([db.end(), redis.quit()]);
  s3.destroy();
}