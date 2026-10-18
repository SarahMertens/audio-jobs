import { Readable } from "node:stream";

// Reads the first `size` bytes of a stream and returns them together with a new stream
// that still contains the whole file, so the upload to storage can keep streaming.
export async function readHeader(stream: Readable, size: number) {
  const iterator: AsyncIterator<Buffer> = stream[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let length = 0;

  while (length < size) {
    const { value, done } = await iterator.next();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }

  const head = Buffer.concat(chunks);
  let totalBytes = head.length;

  async function* rest() {
    if (head.length > 0) yield head;
    while (true) {
      const { value, done } = await iterator.next();
      if (done) return;
      totalBytes += value.length;
      yield value;
    }
  }

  return {
    header: head.subarray(0, size),
    body: Readable.from(rest()),
    // Only final once `body` has been fully consumed.
    totalBytes: () => totalBytes,
  };
}