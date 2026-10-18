import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { config } from "./config.js";
import { registerErrorHandler } from "./errors.js";
import { getHealth } from "./health.js";
import { uploadRoutes } from "./uploads/routes.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  registerErrorHandler(app);

  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 5,
      fileSize: config.MAX_UPLOAD_MB * 1024 * 1024,
    },
  });

  app.get("/health", async (_request, reply) => {
    const health = await getHealth();
    return reply.code(health.status === "ok" ? 200 : 503).send(health);
  });

  await app.register(uploadRoutes);

  return app;
}