import type { FastifyError, FastifyInstance } from "fastify";

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }

    // Errors from Fastify itself or its plugins (bad JSON, wrong content type, ...).
    if (err.statusCode !== undefined && err.statusCode < 500) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code ?? "BAD_REQUEST", message: err.message } });
    }

    // Never leak internal details (SQL, stack traces) to the client.
    request.log.error(err);
    return reply
      .code(500)
      .send({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
  });
}