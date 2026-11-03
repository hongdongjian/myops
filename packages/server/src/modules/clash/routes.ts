import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import { ClashService } from './service.js';
import { startClashRuleRefresh } from './auto-refresh.js';
import { ClashQuantumultXService } from './quantumultx-service.js';
import { AppError } from '../../core/errors.js';
import {
  AddBodySchema,
  ClashConfigSchema,
  ClashResourceGroupSchema,
  DeleteBodySchema,
  RefreshBodySchema,
  type ClashResourceGroup,
  type ApiEnvelope,
} from './schema.js';

interface ClashPluginOptions {
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

export const clashModule = fp<ClashPluginOptions>(async (app, opts) => {
  const service = new ClashService(opts.deps);
  const quantumultx = new ClashQuantumultXService(service, opts.deps.paths);
  let stopAutoRefresh: (() => Promise<void>) | undefined;
  app.addHook('onReady', async () => { stopAutoRefresh = startClashRuleRefresh(service, app.log); });
  app.addHook('onClose', async () => { await stopAutoRefresh?.(); });

  app.get('/api/clash/config', async (): Promise<ApiEnvelope> => {
    const data = await service.loadConfig();
    return { success: true, data };
  });

  app.put('/api/clash/config', async (req): Promise<ApiEnvelope> => {
    const cfg = ClashConfigSchema.parse(req.body);
    await service.saveConfig(cfg);
    await service.syncManifest();
    return { success: true, message: '配置已保存' };
  });

  app.get('/api/clash/template', async (): Promise<ApiEnvelope> => {
    const text = await service.loadTemplate();
    return { success: true, data: { content: text } };
  });

  app.put('/api/clash/template', async (req): Promise<ApiEnvelope> => {
    const body = req.body as { content?: unknown };
    if (typeof body?.content !== 'string') {
      throw new AppError('CLASH_INVALID_BODY', 'content must be a string', 400);
    }
    await service.saveTemplate(body.content);
    const manifest = await service.syncManifest();
    service.refresh().catch((err) => {
      app.log.warn({ err }, 'clash background refresh failed');
    });
    return { success: true, data: manifest, message: 'YAML 模板已保存，资源开始后台下载' };
  });

  app.get('/api/clash/groups', async (): Promise<ApiEnvelope> => {
    const names = await service.getGroupNames();
    return { success: true, data: { groups: names } };
  });

  app.get('/api/clash/resources', async (): Promise<ApiEnvelope> => {
    const manifest = await service.loadManifest();
    return { success: true, data: manifest };
  });

  app.post('/api/clash/resources/refresh', async (req): Promise<ApiEnvelope> => {
    const body = RefreshBodySchema.parse(req.body ?? {});
    const manifest = await service.refresh(body.group, body.url);
    return { success: true, data: manifest, message: '资源已刷新' };
  });

  app.post('/api/clash/resources/add', async (req): Promise<ApiEnvelope> => {
    const body = AddBodySchema.parse(req.body);
    const manifest = await service.addManual(body.group, body.url);
    return { success: true, data: manifest, message: '资源已新增' };
  });

  app.delete('/api/clash/resources', async (req): Promise<ApiEnvelope> => {
    const body = DeleteBodySchema.parse(req.body);
    const manifest = await service.removeEntry(body.group, body.filename);
    return { success: true, data: manifest, message: '资源已删除' };
  });

  app.post('/api/clash/subscribe/rotate-key', async (): Promise<ApiEnvelope> => {
    const apiKey = await service.rotateApiKey();
    return { success: true, data: { api_key: apiKey }, message: '订阅密钥已更新' };
  });

  const authenticatedConfig = async (req: FastifyRequest) => {
    const cfg = await service.loadConfig();
    const provided = (req.query as Record<string, string>)['api-key'];
    if (!cfg.api_key || provided !== cfg.api_key) {
      throw new AppError('CLASH_UNAUTHORIZED', 'invalid or missing api-key', 401);
    }
    return cfg;
  };

  const sendStatic = async (group: ClashResourceGroup, filename: string, reply: FastifyReply) => {
    const filePath = await service.resolveStaticPath(group, filename).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (!filePath) {
      throw new AppError('CLASH_NOT_FOUND', 'resource not found', 404);
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] ?? 'application/octet-stream';
    const data = await fsp.readFile(filePath);
    return reply.header('Content-Type', mime).header('Cache-Control', 'private, max-age=300').send(data);
  };
  app.get('/api/clash/static/:group/:filename', async (req, reply) => {
    await authenticatedConfig(req);
    const params = req.params as { group: string; filename: string };
    return sendStatic(ClashResourceGroupSchema.parse(params.group), params.filename, reply);
  });
  app.get('/api/static/icon/:filename', async (req, reply) => {
    await authenticatedConfig(req);
    return sendStatic('icon', (req.params as { filename: string }).filename, reply);
  });

  app.get('/api/clash/quantumultx/report', async (): Promise<ApiEnvelope> => {
    const cfg = await service.loadConfig();
    const result = await quantumultx.build(cfg.qx_public_base_url?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:3333');
    return { success: true, data: { stats: result.stats, issues: result.issues } };
  });

  app.get('/api/qx/static/rules/:id', async (req, reply) => {
    await authenticatedConfig(req);
    const id = (req.params as { id: string }).id;
    if (!/^[a-f0-9]{24}$/.test(id)) throw new AppError('QX_RULE_NOT_FOUND', '规则资源不存在', 404);
    const content = await quantumultx.buildRuleResource(id);
    return reply.header('Content-Type', 'text/plain; charset=utf-8').send(content);
  });
  const sendSubscription = async (req: FastifyRequest, reply: FastifyReply, format: 'clash' | 'quantumultx') => {
    const cfg = await authenticatedConfig(req);
    const configured = format === 'clash' ? cfg.clash_public_base_url : cfg.qx_public_base_url;
    const baseUrl = configured?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:3333';
    if (format === 'quantumultx') {
      const result = await quantumultx.build(baseUrl);
      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="QuantumultX.conf"')
        .header('X-QX-Skipped-Nodes', String(result.stats.skippedNodes))
        .header('X-QX-Skipped-Rules', String(result.stats.skippedRules))
        .send(result.content);
    }
    const merged = await service.buildSubscribe(baseUrl);
    reply
      .header('Content-Type', 'text/yaml; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="clash-config.yaml"')
      .send(merged);
  };
  app.get('/api/clash/subscribe', async (req, reply) => {
    const format = (req.query as Record<string, string>).format ?? 'clash';
    if (!['clash', 'quantumultx', 'qx'].includes(format)) throw new AppError('CLASH_INVALID_FORMAT', 'unknown subscription format', 400);
    return sendSubscription(req, reply, format === 'clash' ? 'clash' : 'quantumultx');
  });
  app.get('/api/qx/subscribe', async (req, reply) => sendSubscription(req, reply, 'quantumultx'));
});
