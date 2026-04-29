import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { ClaudeProvidersService } from './service.js';
import {
  ProviderAddRequestSchema,
  ProviderUpdateRequestSchema,
  ProviderNameRequestSchema,
  type ApiEnvelope,
} from './schema.js';

interface PluginOptions {
  deps: Deps;
}

export const claudeProvidersModule = fp<PluginOptions>(async (app, opts) => {
  const service = new ClaudeProvidersService(opts.deps);

  app.get('/api/claude/providers', async (): Promise<ApiEnvelope> => {
    const store = await service.list();
    return {
      success: true,
      data: { providers: store.providers, activeProvider: store.activeProvider },
    };
  });

  app.post('/api/claude/providers/add', async (req): Promise<ApiEnvelope> => {
    const body = ProviderAddRequestSchema.parse(req.body ?? {});
    await service.add(body);
    return { success: true, message: 'provider added' };
  });

  app.post('/api/claude/providers/update', async (req): Promise<ApiEnvelope> => {
    const body = ProviderUpdateRequestSchema.parse(req.body ?? {});
    await service.update(body);
    return { success: true, message: 'provider updated' };
  });

  app.post('/api/claude/providers/delete', async (req): Promise<ApiEnvelope> => {
    const body = ProviderNameRequestSchema.parse(req.body ?? {});
    await service.remove(body.name);
    return { success: true, message: 'provider deleted' };
  });

  app.post('/api/claude/providers/apply', async (req): Promise<ApiEnvelope> => {
    const body = ProviderNameRequestSchema.parse(req.body ?? {});
    await service.apply(body.name);
    return { success: true, message: 'provider applied' };
  });
});
