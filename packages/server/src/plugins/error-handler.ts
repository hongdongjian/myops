import fp from 'fastify-plugin';
import { AppError } from '../core/errors.js';
import { ZodError } from 'zod';

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({ success: false, error: err.message });
      return;
    }
    if (err instanceof ZodError) {
      const message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      reply.status(400).send({ success: false, error: message });
      return;
    }
    app.log.error({ err }, 'unhandled error');
    reply.status(500).send({ success: false, error: 'internal error' });
  });
});
