import { z } from "zod";

export type ProcessorInput = {
  audio: Buffer;
  mimeType: string;
  fileName: string;
  // 1 for the first try, 2 for the first retry, ...
  attempt: number;
  resultCount: number;
  // Reports progress between 0 and 100.
  onProgress: (percent: number) => Promise<void>;
};

export const processorResultSchema = z
  .object({
    label: z.string().min(1).max(100),
    text: z.string().max(2000).nullable(),
    value: z.number().finite().nullable(),
    confidence: z.number().min(0).max(1),
    startMs: z.number().int().min(0).nullable(),
    endMs: z.number().int().min(0).nullable(),
  })
  .refine((r) => r.text !== null || r.value !== null, "a result needs text or a value")
  .refine(
    (r) => r.endMs === null || (r.startMs !== null && r.endMs >= r.startMs),
    "endMs must be after startMs",
  );

export type ProcessorResult = z.infer<typeof processorResultSchema>;

// Every processor (mock, real speech-to-text, ...) implements this one interface,
// so the worker doesn't need to know which one it is talking to.
export interface AudioProcessor {
  readonly name: string;
  process(input: ProcessorInput): Promise<ProcessorResult[]>;
}

export class ProcessorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    // Retrying only makes sense when the next attempt could succeed.
    readonly retryable: boolean,
  ) {
    super(message);
  }
}