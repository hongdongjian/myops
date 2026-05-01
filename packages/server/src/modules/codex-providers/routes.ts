import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { CodexProvidersService } from './service.js';
import {
  ProviderAddRequestSchema,
  ProviderUpdateRequestSchema,
  ProviderNameRequestSchema,
  type ApiEnvelope,
} from './schema.js';

interface PluginOptions {
  deps: Deps;
}

export const codexProvidersModule = fp<PluginOptions>(async (app, opts) => {
  const service = new CodexProvidersService(opts.deps);

  app.get('/api/codex/providers', async (): Promise<ApiEnvelope> => {
    const data = await service.list();
    return { success: true, data };
  });

  app.post('/api/codex/providers/add', async (req): Promise<ApiEnvelope> => {
    const body = ProviderAddRequestSchema.parse(req.body ?? {});
    await service.add(body);
    return { success: true, message: 'provider added' };
  });

  app.post('/api/codex/providers/update', async (req): Promise<ApiEnvelope> => {
    const body = ProviderUpdateRequestSchema.parse(req.body ?? {});
    await service.update(body);
    return { success: true, message: 'provider updated' };
  });

  app.post('/api/codex/providers/delete', async (req): Promise<ApiEnvelope> => {
    const body = ProviderNameRequestSchema.parse(req.body ?? {});
    await service.remove(body.name);
    return { success: true, message: 'provider deleted' };
  });

  app.post('/api/codex/providers/apply', async (req): Promise<ApiEnvelope> => {
    const body = ProviderNameRequestSchema.parse(req.body ?? {});
    await service.apply(body.name);
    return { success: true, message: 'provider applied' };
  });
});
