import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { errorHandlerPlugin } from './error-handler.js';
import { AppError } from '../core/errors.js';

describe('errorHandler', () => {
  it('serializes AppError to standard envelope', async () => {
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    app.get('/x', () => { throw new AppError('FOO', 'bar', 422); });
    const r = await app.inject({ method: 'GET', url: '/x' });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toEqual({ error: { code: 'FOO', message: 'bar' } });
  });
});
