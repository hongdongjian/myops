import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { CodexAgentsService } from './service.js';
import { CodexAgentsSaveRequestSchema, type ApiEnvelope } from './schema.js';

interface PluginOptions {
  deps: Deps;
}

export const codexAgentsModule = fp<PluginOptions>(async (app, opts) => {
  const service = new CodexAgentsService(opts.deps);

  app.get('/api/codex/agents', async (): Promise<ApiEnvelope> => {
    const data = await service.get();
    return { success: true, data };
  });

  app.post('/api/codex/agents/save', async (req): Promise<ApiEnvelope> => {
    const body = CodexAgentsSaveRequestSchema.parse(req.body ?? {});
    const data = await service.save(body.content);
    return { success: true, message: 'codex agents saved', data };
  });

  app.get('/api/codex/agents/sync-status', async (): Promise<ApiEnvelope> => {
    const data = await service.syncStatus();
    return { success: true, data };
  });

  app.post('/api/codex/agents/sync', async (): Promise<ApiEnvelope> => {
    await service.sync();
    return { success: true, message: 'AGENTS.md 已同步' };
  });
});
