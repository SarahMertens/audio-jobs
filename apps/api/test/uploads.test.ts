import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startApi } from "./api.js";
import { closeHelpers, resetData, sample, testDb } from "./helpers.js";

let api: Awaited<ReturnType<typeof startApi>>;

beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
  await closeHelpers();
});
beforeEach(resetData);

describe("POST /uploads", () => {
  it.each([
    ["sample.mp3", "audio/mpeg"],
    ["sample.wav", "audio/wav"],
    ["sample.m4a", "audio/mp4"],
  ])("accepts %s and stores it as %s", async (file, mimeType) => {
    const body = await sample(file);
    const response = await api.upload(body, file);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ fileName: file, mimeType, sizeBytes: body.length });

    const row = await testDb.query("SELECT mime_type, size_bytes FROM audio_files WHERE id = $1", [
      response.body.audioId,
    ]);
    expect(row.rows[0]).toEqual({ mime_type: mimeType, size_bytes: String(body.length) });
  });

  it("detects the format from the content, not from the file name", async () => {
    const response = await api.upload(await sample("sample.wav"), "renamed.mp3");
    expect(response.status).toBe(201);
    expect(response.body.mimeType).toBe("audio/wav");
  });

  it.each(["sample.ogg", "fake-audio.mp3"])("rejects %s as an unsupported format", async (file) => {
    const response = await api.upload(await sample(file), file);
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_FORMAT");
  });

  it("rejects an empty file", async () => {
    const response = await api.upload(Buffer.alloc(0), "empty.mp3");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("EMPTY_FILE");
  });

  it("rejects a file above the size limit and keeps no record of it", async () => {
    // A valid WAV header followed by 1.5 MB of silence; the test limit is 1 MB.
    const wav = Buffer.alloc(1.5 * 1024 * 1024);
    (await sample("sample.wav")).copy(wav, 0, 0, 44);

    const response = await api.upload(wav, "big.wav");

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("FILE_TOO_LARGE");
    expect((await testDb.query("SELECT count(*)::int AS n FROM audio_files")).rows[0].n).toBe(0);
  });

  it("asks for multipart when something else is sent", async () => {
    const response = await fetch(`${api.baseUrl}/uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(415);
    expect(((await response.json()) as any).error.code).toBe("EXPECTED_MULTIPART");
  });
});