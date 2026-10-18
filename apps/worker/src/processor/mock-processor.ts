import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { parseBuffer } from "music-metadata";
import {
  type AudioProcessor,
  ProcessorError,
  type ProcessorInput,
  type ProcessorResult,
} from "./types.js";

const PROGRESS_STEPS = 10;

const WORDS = [
  "the", "team", "will", "review", "upload", "results", "today", "audio", "signal", "clear",
  "meeting", "starts", "after", "lunch", "please", "check", "the", "status", "again", "later",
  "this", "sample", "sounds", "good", "we", "need", "more", "data", "before", "release",
];

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function readDurationMs(audio: Buffer, mimeType: string): Promise<number> {
  try {
    const metadata = await parseBuffer(audio, { mimeType }, { duration: true });
    const seconds = metadata.format.duration;
    if (seconds !== undefined && Number.isFinite(seconds) && seconds > 0) {
      return Math.round(seconds * 1000);
    }
  } catch {
    // Falls through to the error below: a parser crash also means the file is unusable.
  }
  throw new ProcessorError("INVALID_AUDIO", "The audio file could not be decoded", false);
}

export class MockProcessor implements AudioProcessor {
  readonly name = "mock";

  constructor(private readonly processingMs: number) {}

  async process({ audio, mimeType, resultCount, onProgress }: ProcessorInput) {
    const durationMs = await readDurationMs(audio, mimeType);

    for (let step = 1; step < PROGRESS_STEPS; step++) {
      await sleep(this.processingMs / PROGRESS_STEPS);
      await onProgress(Math.round((step / PROGRESS_STEPS) * 90));
    }

    const seed = createHash("sha256").update(audio).digest().readUInt32BE(0);
    const random = seededRandom(seed);
    const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;

    const results: ProcessorResult[] = [];
    for (let i = 0; i < resultCount; i++) {
      const startMs = Math.floor((i * durationMs) / resultCount);
      const endMs = Math.floor(((i + 1) * durationMs) / resultCount);
      const confidence = round(0.6 + random() * 0.39, 2);
      const kind = random();

      if (kind < 0.6) {
        const length = 3 + Math.floor(random() * 6);
        const words = Array.from({ length }, () => pick(WORDS));
        const sentence = words.join(" ");
        results.push({
          label: "speech",
          text: sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".",
          value: null,
          confidence,
          startMs,
          endMs,
        });
      } else {
        // Non-speech segments carry a loudness value in dBFS instead of text.
        const [label, min, max]: [string, number, number] =
          kind < 0.8 ? ["music", -18, -8] : kind < 0.9 ? ["noise", -35, -20] : ["silence", -60, -45];
        results.push({
          label,
          text: null,
          value: round(min + random() * (max - min), 1),
          confidence,
          startMs,
          endMs,
        });
      }
    }

    return results;
  }
}