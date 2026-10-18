import Fastify from "fastify";
import { closeClients } from "./clients.js";
import { config } from "./config.js";
import { getHealth } from "./health.js";

const app = Fastify({ logger: true });

app.get("/health", async (_request, reply) => {
  const health = await getHealth();
  return reply.code(health.status === "ok" ? 200 : 503).send(health);
});

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await closeClients();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}