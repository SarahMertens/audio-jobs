import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.js";
import { closeClients } from "../src/clients.js";

// Starts the real API on a random free port, so tests use plain HTTP like a browser would.
export async function startApi() {
  const app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    async upload(body: Buffer, fileName: string) {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(body)]), fileName);
      const response = await fetch(`${baseUrl}/uploads`, { method: "POST", body: form });
      return { status: response.status, body: (await response.json()) as any };
    },
    async createJob(body: unknown, idempotencyKey?: string) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      const response = await fetch(`${baseUrl}/jobs`, { method: "POST", headers, body: JSON.stringify(body) });
      return { status: response.status, headers: response.headers, body: (await response.json()) as any };
    },
    async get(path: string) {
      const response = await fetch(`${baseUrl}${path}`);
      return { status: response.status, body: (await response.json()) as any };
    },
    async stop() {
      await app.close();
      await closeClients();
    },
  };
}