import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { CodexVersionService, type CodexUpgradeHooks } from './service.js';
import type { ApiEnvelope } from './schema.js';

interface PluginOptions {
  deps: Deps;
  hooks?: CodexUpgradeHooks;
}

export const codexVersionModule = fp<PluginOptions>(async (app, opts) => {
  const service = new CodexVersionService(opts.deps, opts.hooks);

  app.get('/api/codex/version', async (): Promise<ApiEnvelope> => {
    const data = await service.getStatus();
    return { success: true, data };
  });

  app.post('/api/codex/upgrade', async (_req, reply): Promise<ApiEnvelope> => {
    const result = await service.upgrade();
    if (!result.ok) {
      reply.status(500);
      return { success: false, error: result.message, data: result.payload };
    }
    return { success: true, message: result.message, data: result.payload };
  });
});
