import { randomUUID } from "node:crypto";
import path from "node:path";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { FastifyInstance } from "fastify";
import { db, s3 } from "../clients.js";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { detectAudioFormat, HEADER_BYTES } from "./audio-format.js";
import { readHeader } from "./read-header.js";

type AudioFileRow = {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: string;
  created_at: Date;
};

function cleanFileName(name: string): string {
  // Some browsers send a full path; keep only the name and cap the length.
  const base = path.basename(name.replace(/\\/g, "/")).trim();
  return (base || "audio").slice(0, 255);
}

async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key })).catch(() => {});
}

export async function uploadRoutes(app: FastifyInstance) {
  app.post("/uploads", async (request, reply) => {
    if (!request.isMultipart()) {
      throw new AppError(415, "EXPECTED_MULTIPART", "Send the file as multipart/form-data");
    }

    const file = await request.file();
    if (!file) {
      throw new AppError(400, "NO_FILE", "No file was sent. Use the form field 'file'.");
    }

    const { header, body, totalBytes } = await readHeader(file.file, HEADER_BYTES);
    if (header.length === 0) {
      throw new AppError(400, "EMPTY_FILE", "The file is empty");
    }

    const format = detectAudioFormat(header);
    if (!format) {
      throw new AppError(415, "UNSUPPORTED_FORMAT", "Only MP3, WAV and M4A files are supported");
    }

    const id = randomUUID();
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const storageKey = `uploads/${now.getUTCFullYear()}/${month}/${id}.${format.extension}`;

    const tooLarge = new AppError(
      413,
      "FILE_TOO_LARGE",
      `The file is larger than ${config.MAX_UPLOAD_MB} MB`,
    );

    try {
      await new Upload({
        client: s3,
        params: {
          Bucket: config.S3_BUCKET,
          Key: storageKey,
          Body: body,
          ContentType: format.mimeType,
        },
      }).done();
    } catch (err) {
      await deleteObject(storageKey);
      if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw tooLarge;
      throw err;
    }

    // When a stream hits the size limit, the plugin cuts it off silently instead of throwing.
    if (file.file.truncated) {
      await deleteObject(storageKey);
      throw tooLarge;
    }

    let row: AudioFileRow;
    try {
      const result = await db.query<AudioFileRow>(
        `INSERT INTO audio_files (id, storage_key, original_name, mime_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, original_name, mime_type, size_bytes, created_at`,
        [id, storageKey, cleanFileName(file.filename), format.mimeType, totalBytes()],
      );
      row = result.rows[0]!;
    } catch (err) {
      // Don't leave an orphaned object in storage when the database write fails.
      await deleteObject(storageKey);
      throw err;
    }
        // No file name in the logs: it can contain personal information.
    request.log.info({ audioId: row.id, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes) }, "audio uploaded");

    return reply.code(201).send({
      audioId: row.id,
      fileName: row.original_name,
      mimeType: row.mime_type,
      // pg returns bigint columns as strings to avoid precision loss.
      sizeBytes: Number(row.size_bytes),
      createdAt: row.created_at.toISOString(),
    });
  });
}