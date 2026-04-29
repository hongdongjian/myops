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
    expect(r.json()).toEqual({ success: false, error: 'bar' });
  });

  it('serializes ZodError to standard envelope', async () => {
    const { z } = await import('zod');
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    app.get('/x', () => { z.object({ name: z.string() }).parse({}); });
    const r = await app.inject({ method: 'GET', url: '/x' });
    expect(r.statusCode).toBe(400);
    const body = r.json();
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
    expect(body.error).toMatch(/name/);
  });

  it('serializes unknown error to standard envelope', async () => {
    const app = Fastify();
    app.log.level = 'silent';
    await app.register(errorHandlerPlugin);
    app.get('/x', () => { throw new Error('boom'); });
    const r = await app.inject({ method: 'GET', url: '/x' });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ success: false, error: 'internal error' });
  });
});
