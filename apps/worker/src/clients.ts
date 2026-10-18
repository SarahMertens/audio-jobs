import { S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import { pino } from "pino";
import { config } from "./config.js";

export const log = pino({ base: { service: "worker" } });

export const db = new pg.Pool({ connectionString: config.DATABASE_URL });

db.on("error", (err) => {
  log.warn({ err: err.message }, "postgres: idle connection lost");
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