import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { ClaudeInstructionsService } from './service.js';
import { InstructionsSaveRequestSchema, type ApiEnvelope } from './schema.js';

interface PluginOptions {
  deps: Deps;
}

export const claudeInstructionsModule = fp<PluginOptions>(async (app, opts) => {
  const service = new ClaudeInstructionsService(opts.deps);

  app.get('/api/claude/instructions', async (): Promise<ApiEnvelope> => {
    const data = await service.get();
    return { success: true, data };
  });

  app.post('/api/claude/instructions/save', async (req): Promise<ApiEnvelope> => {
    const body = InstructionsSaveRequestSchema.parse(req.body ?? {});
    const data = await service.save(body.content);
    return { success: true, message: 'instructions saved', data };
  });

  app.get('/api/claude/instructions/sync-status', async (): Promise<ApiEnvelope> => {
    const data = await service.syncStatus();
    return { success: true, data };
  });

  app.post('/api/claude/instructions/sync', async (): Promise<ApiEnvelope> => {
    await service.sync();
    return { success: true, message: 'CLAUDE.md 已同步' };
  });
});
