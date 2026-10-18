import { setTimeout as sleep } from "node:timers/promises";
import { type AudioProcessor, ProcessorError, type ProcessorInput } from "./types.js";

// How many attempts fail when the file name contains this word.
const NAME_TRIGGERS: [string, number][] = [
  ["fail-always", Number.POSITIVE_INFINITY],
  ["fail-twice", 2],
  ["fail-once", 1],
];

// Wraps a real processor and makes it fail on purpose, so the retry path can be demonstrated.
// A file named "meeting-fail-once.mp3" fails on the first attempt and succeeds on the retry.
export class FailureInjectingProcessor implements AudioProcessor {
  constructor(
    private readonly inner: AudioProcessor,
    private readonly randomFailureRate: number,
  ) {}

  get name() {
    return `${this.inner.name} (with failure injection)`;
  }

  async process(input: ProcessorInput) {
    const fileName = input.fileName.toLowerCase();
    const failingAttempts = NAME_TRIGGERS.find(([word]) => fileName.includes(word))?.[1] ?? 0;

    if (input.attempt <= failingAttempts || Math.random() < this.randomFailureRate) {
      // A real outage usually takes a moment before it errors (a timeout, a refused connection).
      await sleep(500);
      throw new ProcessorError(
        "PROCESSOR_UNAVAILABLE",
        "The processing service did not respond (simulated failure)",
        true,
      );
    }

    return this.inner.process(input);
  }
}