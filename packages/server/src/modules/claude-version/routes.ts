import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { ClaudeVersionService } from './service.js';
import type { ApiEnvelope } from './schema.js';

interface PluginOptions {
  deps: Deps;
}

export const claudeVersionModule = fp<PluginOptions>(async (app, opts) => {
  const service = new ClaudeVersionService(opts.deps);

  app.get('/api/claude/version', async (): Promise<ApiEnvelope> => {
    const data = await service.getStatus();
    return { success: true, data };
  });

  app.post('/api/claude/upgrade', async (_req, reply): Promise<ApiEnvelope> => {
    try {
      const result = await service.upgrade();
      if (!result.ok) {
        reply.status(500);
        return {
          success: false,
          error: result.message,
          data: result.payload,
        };
      }
      return { success: true, message: result.message, data: result.payload };
    } catch (err) {
      // bubble AppError to error handler
      throw err;
    }
  });
});
