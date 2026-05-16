import fp from 'fastify-plugin';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import { QuantumultXService } from './service.js';
import { AppError } from '../../core/errors.js';
import {
  AddBodySchema,
  DeleteBodySchema,
  QxConfigSchema,
  RefreshBodySchema,
  QxGroupSchema,
  type ApiEnvelope,
} from './schema.js';

interface QxPluginOptions {
  deps: Deps;
}

const MIME: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.conf': 'text/plain; charset=utf-8',
  '.list': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export const quantumultxModule = fp<QxPluginOptions>(async (app, opts) => {
  const service = new QuantumultXService(opts.deps);

  app.get('/api/qx/config', async (): Promise<ApiEnvelope> => {
    const data = await service.loadConfig();
    return { success: true, data };
  });

  app.put('/api/qx/config', async (req): Promise<ApiEnvelope> => {
    const cfg = QxConfigSchema.parse(req.body);
    await service.saveConfig(cfg);
    return { success: true, message: '配置已保存' };
  });

  app.post('/api/qx/subscribe/rotate-key', async (): Promise<ApiEnvelope> => {
    const apiKey = await service.rotateApiKey();
    return { success: true, data: { api_key: apiKey }, message: '订阅密钥已更新' };
  });

  app.get('/api/qx/conf', async (): Promise<ApiEnvelope> => {
    const text = await service.loadConf();
    return { success: true, data: { content: text } };
  });

  app.put('/api/qx/conf', async (req): Promise<ApiEnvelope> => {
    const body = req.body as { content?: unknown };
    if (typeof body?.content !== 'string') {
      throw new AppError('QX_INVALID_BODY', 'content must be a string', 400);
    }
    await service.saveConf(body.content);
    const manifest = await service.syncManifestFromConf();
    // Kick off background download; do not block the response
    service.refresh().catch((err) => {
      app.log.warn({ err }, 'qx background refresh failed');
    });
    return { success: true, data: manifest, message: '配置已保存，资源开始后台下载' };
  });

  app.get('/api/qx/resources', async (): Promise<ApiEnvelope> => {
    const manifest = await service.loadManifest();
    return { success: true, data: manifest };
  });

  app.post('/api/qx/resources/refresh', async (req): Promise<ApiEnvelope> => {
    const body = RefreshBodySchema.parse(req.body ?? {});
    const manifest = await service.refresh(body.group, body.url);
    return { success: true, data: manifest, message: '资源已刷新' };
  });

  app.post('/api/qx/resources/add', async (req): Promise<ApiEnvelope> => {
    const body = AddBodySchema.parse(req.body);
    const manifest = await service.addManual(body.group, body.url);
    return { success: true, data: manifest, message: '资源已新增' };
  });

  app.delete('/api/qx/resources', async (req): Promise<ApiEnvelope> => {
    const body = DeleteBodySchema.parse(req.body);
    const manifest = await service.removeEntry(body.group, body.filename);
    return { success: true, data: manifest, message: '资源已删除' };
  });

  app.get('/api/qx/static/:group/:filename', async (req, reply) => {
    const params = req.params as { group: string; filename: string };
    const group = QxGroupSchema.parse(params.group);
    const filename = params.filename;
    const filePath = await service.resolveStaticPath(group, filename).catch(() => null);
    if (!filePath) {
      throw new AppError('QX_NOT_FOUND', 'resource not found', 404);
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] ?? 'application/octet-stream';
    const data = await fsp.readFile(filePath);
    reply.header('Content-Type', mime).header('Cache-Control', 'public, max-age=300').send(data);
  });

  app.get('/api/qx/subscribe', async (req, reply) => {
    const cfg = await service.loadConfig();
    if (cfg.api_key) {
      const provided = (req.query as Record<string, string>)['api-key'];
      if (provided !== cfg.api_key) {
        throw new AppError('QX_UNAUTHORIZED', 'invalid or missing api-key', 401);
      }
    }
    let baseUrl: string;
    const configured = cfg.public_base_url?.trim().replace(/\/+$/, '');
    if (configured) {
      baseUrl = configured;
    } else {
      baseUrl = 'http://127.0.0.1:3333';
    }
    const merged = await service.buildSubscribe(baseUrl);
    reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="QuantumultX.conf"')
      .send(merged);
  });
});
