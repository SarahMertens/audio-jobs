import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { db, redis, s3 } from "./clients.js";
import { config } from "./config.js";

type CheckResult = { ok: true } | { ok: false; error: string };

async function check(fn: () => Promise<unknown>): Promise<CheckResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

function describeError(err: unknown): string {
  // HeadBucket returns a bare 404 without a body, so the SDK message is just "UnknownError".
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  if (status === 404) return "bucket not found";
  if (status === 403) return "access denied (check S3 keys)";
  return err instanceof Error ? err.message : String(err);
}

export async function getHealth() {
  const [postgres, redisCheck, storage] = await Promise.all([
    check(() => db.query("SELECT 1")),
    check(() => redis.ping()),
    check(() => s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }))),
  ]);

  const checks = { postgres, redis: redisCheck, storage };
  const healthy = Object.values(checks).every((c) => c.ok);

  return { status: healthy ? "ok" : "degraded", checks } as const;
}