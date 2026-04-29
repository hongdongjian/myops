import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { AssetsService } from './service.js';
import {
  AssetContentQuerySchema,
  AssetListQuerySchema,
  AssetSyncRequestSchema,
  AssetUninstallRequestSchema,
  type ApiEnvelope,
} from './schema.js';

interface AssetsPluginOptions {
  deps: Deps;
}

export const assetsModule = fp<AssetsPluginOptions>(async (app, opts) => {
  const service = new AssetsService(opts.deps);

  app.get('/api/assets/list', async (req): Promise<ApiEnvelope> => {
    const { category } = AssetListQuerySchema.parse(req.query ?? {});
    const data = service.list(category);
    return { success: true, data };
  });

  app.get('/api/assets/content', async (req): Promise<ApiEnvelope> => {
    const { category, source, name } = AssetContentQuerySchema.parse(req.query ?? {});
    const content = await service.readContent(category, source, name);
    return { success: true, data: { category, source, name, content } };
  });

  app.post('/api/assets/sync', async (req): Promise<ApiEnvelope> => {
    const body = AssetSyncRequestSchema.parse(req.body);
    const data = await service.sync(body.category);
    return {
      success: true,
      message: `${body.category} synced to project`,
      data: { category: body.category, ...data },
    };
  });

  app.post('/api/assets/uninstall', async (req): Promise<ApiEnvelope> => {
    const body = AssetUninstallRequestSchema.parse(req.body);
    await service.uninstall(body.category, body.name, body.removeProject ?? false);
    return { success: true, message: `${body.category}/${body.name} uninstalled` };
  });
});
