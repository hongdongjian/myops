import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { ClashService } from './service.js';
import { ClashConfigSchema, type ApiEnvelope } from './schema.js';
import { AppError } from '../../core/errors.js';

interface ClashPluginOptions {
  deps: Deps;
}

export const clashModule = fp<ClashPluginOptions>(async (app, opts) => {
  const service = new ClashService(opts.deps);

  app.get('/api/clash/config', async (): Promise<ApiEnvelope> => {
    const data = await service.loadConfig();
    return { success: true, data };
  });

  app.put('/api/clash/config/save', async (req): Promise<ApiEnvelope> => {
    const cfg = ClashConfigSchema.parse(req.body);
    await service.saveConfig(cfg);
    return { success: true, message: '配置已保存' };
  });

  app.get('/api/clash/upstream', async (): Promise<ApiEnvelope> => {
    const cfg = await service.loadConfig();
    if (!cfg.subscribe_url) {
      throw new AppError('CLASH_NO_URL', '请先配置上游订阅 URL', 400);
    }
    const { info } = await service.getUpstreamCached(cfg.subscribe_url, false);
    return { success: true, data: info };
  });

  app.post('/api/clash/upstream/refresh', async (): Promise<ApiEnvelope> => {
    const cfg = await service.loadConfig();
    if (!cfg.subscribe_url) {
      throw new AppError('CLASH_NO_URL', '请先配置上游订阅 URL', 400);
    }
    const { info } = await service.getUpstreamCached(cfg.subscribe_url, true);
    return { success: true, data: info, message: '上游配置已刷新' };
  });

  app.get('/api/clash/subscribe', async (_req, reply) => {
    const cfg = await service.loadConfig();
    const merged = await service.buildSubscribe(cfg);
    reply
      .header('Content-Type', 'text/yaml; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="clash-config.yaml"')
      .send(merged);
  });
});
