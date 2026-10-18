export type AudioFormat = {
  mimeType: "audio/mpeg" | "audio/wav" | "audio/mp4";
  extension: "mp3" | "wav" | "m4a";
};

export const HEADER_BYTES = 12;

const M4A_BRANDS = new Set(["M4A ", "M4B ", "mp41", "mp42", "isom", "iso2", "dash"]);

// Detects the format from the first bytes of the file ("magic bytes").
// The file name and the browser's Content-Type can't be trusted: both are chosen by the client.
export function detectAudioFormat(header: Buffer): AudioFormat | null {
  if (header.length < HEADER_BYTES) return null;

  const ascii = (start: number, end: number) => header.toString("latin1", start, end);

  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") {
    return { mimeType: "audio/wav", extension: "wav" };
  }

  if (ascii(4, 8) === "ftyp" && M4A_BRANDS.has(ascii(8, 12))) {
    return { mimeType: "audio/mp4", extension: "m4a" };
  }

  if (ascii(0, 3) === "ID3") {
    return { mimeType: "audio/mpeg", extension: "mp3" };
  }

  // MPEG audio frame: 11 sync bits set, and a non-zero layer (zero would be AAC/ADTS).
  const b0 = header[0]!;
  const b1 = header[1]!;
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0 && (b1 & 0x06) !== 0) {
    return { mimeType: "audio/mpeg", extension: "mp3" };
  }

  return null;
}