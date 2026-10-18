import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import { runMigrations } from "../src/db/migrations.js";

// Runs once before all tests: makes sure the test database and bucket exist and are migrated.
export default async function setup() {
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  const databaseName = databaseUrl.pathname.slice(1);

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
  if (exists.rowCount === 0) {
    // Identifiers can't be query parameters; the name comes from our own config, not from users.
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  }
  await admin.end();

  await runMigrations(databaseUrl.toString());

  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw err;
  }
  s3.destroy();
}