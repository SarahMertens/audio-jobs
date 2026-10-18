import { type AudioProcessor, ProcessorError, type ProcessorInput, type ProcessorResult } from "../src/processor/types.js";

type Behaviour =
  | { kind: "succeed" }
  | { kind: "fail"; code: string; retryable: boolean }
  | { kind: "wrong-count" }
  | { kind: "throw-unknown" };

// A processor whose behaviour each test controls; it also remembers how it was called.
export class FakeProcessor implements AudioProcessor {
  readonly name = "fake";
  calls: ProcessorInput[] = [];

  constructor(private behaviour: Behaviour = { kind: "succeed" }) {}

  setBehaviour(behaviour: Behaviour) {
    this.behaviour = behaviour;
  }

  async process(input: ProcessorInput): Promise<ProcessorResult[]> {
    this.calls.push(input);
    await input.onProgress(50);

    switch (this.behaviour.kind) {
      case "fail":
        throw new ProcessorError(this.behaviour.code, "simulated", this.behaviour.retryable);
      case "throw-unknown":
        throw new Error("database password is hunter2");
      case "wrong-count":
        return makeResults(input.resultCount - 1);
      case "succeed":
        return makeResults(input.resultCount);
    }
  }
}

function makeResults(count: number): ProcessorResult[] {
  return Array.from({ length: count }, (_, i) => ({
    label: "speech",
    text: `part ${i + 1}`,
    value: null,
    confidence: 0.9,
    startMs: i * 1000,
    endMs: (i + 1) * 1000,
  }));
}