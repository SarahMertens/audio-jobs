import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import multipart from '@fastify/multipart';
import Fastify, { LogController } from 'fastify';
import { config } from './config.js';
import { registerErrorHandler } from './errors.js';
import { getHealth } from './health.js';
import { jobRoutes } from './jobs/routes.js';
import { getMetrics } from './metrics.js';
import { uploadRoutes } from './uploads/routes.js';

// Reuse the caller's X-Request-Id when it looks safe, so a request can be followed
// across systems. Anything else (too long, odd characters) gets a fresh id.
function requestId(request: IncomingMessage): string {
  const header = request.headers['x-request-id'];
  if (typeof header === 'string' && /^[\w.-]{1,100}$/.test(header))
    return header;
  return randomUUID();
}

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    genReqId: requestId,
    logController: new LogController({
      requestIdLogLabel: 'requestId',
      // Fastify's own request logs are two lines per request; we write one line ourselves below.
      disableRequestLogging: true,
    }),
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    const entry = {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    };
    // The web app polls every few seconds; successful reads would drown out everything else.
    if (request.method === 'GET' && reply.statusCode < 400)
      request.log.debug(entry, 'request done');
    else request.log.info(entry, 'request done');
  });

  registerErrorHandler(app);

  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 5,
      fileSize: config.MAX_UPLOAD_MB * 1024 * 1024,
    },
  });

  app.get('/health', async (_request, reply) => {
    const health = await getHealth();
    return reply.code(health.status === 'ok' ? 200 : 503).send(health);
  });

  app.get('/metrics', async (_request, reply) => {
    return reply.type('text/plain; version=0.0.4').send(await getMetrics());
  });

  await app.register(uploadRoutes);
  await app.register(jobRoutes);

  return app;
}
