import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Redis } from "ioredis";
import pg from "pg";

// Shared by the API and worker tests. Uses its own connections so it doesn't depend on app code.

export const SAMPLES = path.join(import.meta.dirname, "../../../samples");

export const testDb = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true });

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
});

export function sample(name: string): Promise<Buffer> {
  return readFile(path.join(SAMPLES, name));
}

// Empties the tables and the test queue, so every test starts from a clean state.
export async function resetData() {
  await testDb.query("TRUNCATE audio_files, jobs, job_attempts, results CASCADE");
  if (redis.status === "wait") await redis.connect();
  const keys = await redis.keys(`${process.env.QUEUE_PREFIX}:*`);
  if (keys.length > 0) await redis.del(...keys);
}

// Inserts an uploaded file and a queued job directly, without going through the API.
export async function seedJob(options: {
  file?: string;
  fileName?: string;
  mimeType?: string;
  resultCount?: number;
  uploadObject?: boolean;
}) {
  const file = options.file ?? "sample.mp3";
  const audioId = randomUUID();
  const storageKey = `uploads/test/${audioId}`;
  const body = await sample(file);

  if (options.uploadObject !== false) {
    await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: storageKey, Body: body }));
  }
  await testDb.query(
    `INSERT INTO audio_files (id, storage_key, original_name, mime_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5)`,
    [audioId, storageKey, options.fileName ?? file, options.mimeType ?? "audio/mpeg", body.length],
  );
  const job = await testDb.query<{ id: string }>(
    "INSERT INTO jobs (audio_file_id, result_count) VALUES ($1, $2) RETURNING id",
    [audioId, options.resultCount ?? 3],
  );
  return { audioId, jobId: job.rows[0]!.id };
}

export async function getJobRow(jobId: string) {
  const result = await testDb.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
  return result.rows[0];
}

export async function getAttemptRows(jobId: string) {
  const result = await testDb.query(
    "SELECT * FROM job_attempts WHERE job_id = $1 ORDER BY attempt_number",
    [jobId],
  );
  return result.rows;
}

export async function queueHasJob(jobId: string): Promise<boolean> {
  if (redis.status === "wait") await redis.connect();
  return (await redis.exists(`${process.env.QUEUE_PREFIX}:audio-processing:${jobId}`)) === 1;
}

export async function closeHelpers() {
  await testDb.end();
  redis.disconnect();
  s3.destroy();
}