import fp from 'fastify-plugin';
import { AppError } from '../core/errors.js';
import { ZodError } from 'zod';

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
      });
      return;
    }
    app.log.error({ err }, 'unhandled error');
    reply.status(500).send({ error: { code: 'INTERNAL', message: 'internal error' } });
  });
});
