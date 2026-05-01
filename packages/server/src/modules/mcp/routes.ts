import fp from 'fastify-plugin';
import NodeCache from 'node-cache';
import { fetch, EnvHttpProxyAgent } from 'undici';
import type { Deps } from '../../deps.js';
import { XHSService, parseLinesParameter } from './service.js';
import {
  AutostartSetRequestSchema,
  BinaryConfigSaveRequestSchema,
  LogsQuerySchema,
  type ApiEnvelope,
} from './schema.js';

const XHS_RELEASES_URL = 'https://api.github.com/repos/xpzouying/xiaohongshu-mcp/releases';
const releasesCache = new NodeCache({ stdTTL: 60 * 60 });
const proxyAgent = new EnvHttpProxyAgent();

interface PluginOptions {
  deps: Deps;
}

export const mcpModule = fp<PluginOptions>(async (app, opts) => {
  const service = new XHSService(opts.deps);

  app.get('/api/mcp/xiaohongshu/status', async (): Promise<ApiEnvelope> => {
    const data = await service.getStatus();
    return { success: true, data };
  });

  app.post('/api/mcp/xiaohongshu/start', async (): Promise<ApiEnvelope> => {
    const data = await service.start();
    return { success: true, message: 'xiaohongshu mcp started', data };
  });

  app.post('/api/mcp/xiaohongshu/stop', async (): Promise<ApiEnvelope> => {
    const stopped = await service.stop();
    if (stopped) {
      service.appendEventLog('STOP', 'xiaohongshu mcp stopped by console action');
      return { success: true, message: 'xiaohongshu mcp stopped' };
    }
    service.appendEventLog('STOP_SKIP', 'stop requested but service was not running');
    return { success: true, message: 'xiaohongshu mcp process was not running' };
  });

  app.post('/api/mcp/xiaohongshu/restart', async (): Promise<ApiEnvelope> => {
    const data = await service.restart();
    return { success: true, message: 'xiaohongshu mcp restarted', data };
  });

  app.post('/api/mcp/xiaohongshu/login', async (_req, reply): Promise<ApiEnvelope> => {
    const r = await service.login();
    if (!r.ok) reply.status(500);
    return {
      success: r.ok,
      error: r.ok ? undefined : r.error,
      data: { stdout: r.stdout, stderr: r.stderr, removedCookies: r.removedCookies },
    };
  });

  app.get('/api/mcp/xiaohongshu/logs', async (req): Promise<ApiEnvelope> => {
    const { lines } = LogsQuerySchema.parse(req.query ?? {});
    const linesNum = parseLinesParameter(lines, 300, 3000);
    const data = await service.readLogs(linesNum);
    if (data.content === '') {
      const fs = await import('node:fs/promises');
      try {
        await fs.access(service.logPath());
      } catch {
        return { success: true, message: 'log file does not exist yet', data };
      }
    }
    return { success: true, data };
  });

  app.post('/api/mcp/xiaohongshu/logs/clear', async (): Promise<ApiEnvelope> => {
    await service.clearLogs();
    return { success: true, message: 'xiaohongshu mcp logs cleared' };
  });

  app.get('/api/mcp/xiaohongshu/autostart', async (): Promise<ApiEnvelope> => {
    return { success: true, data: service.getAutostart() };
  });

  app.post('/api/mcp/xiaohongshu/autostart/set', async (req): Promise<ApiEnvelope> => {
    const body = AutostartSetRequestSchema.parse(req.body);
    const data = await service.setAutostart(body.enabled);
    return { success: true, data };
  });

  app.get('/api/mcp/xiaohongshu/config', async (): Promise<ApiEnvelope> => {
    return { success: true, data: service.getBinaryConfig() };
  });

  app.post('/api/mcp/xiaohongshu/config/save', async (req): Promise<ApiEnvelope> => {
    const body = BinaryConfigSaveRequestSchema.parse(req.body);
    await service.saveBinaryConfig(body.loginBinaryPath, body.serverBinaryPath);
    return { success: true, data: service.getBinaryConfig() };
  });

  app.get('/api/mcp/xiaohongshu/releases', async (_req, reply): Promise<ApiEnvelope> => {
    const cached = releasesCache.get<unknown[]>('data');
    if (cached !== undefined) return { success: true, data: cached };
    try {
      const res = await fetch(XHS_RELEASES_URL, {
        dispatcher: proxyAgent,
        headers: { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (!res.ok) { reply.status(502); return { success: false, error: `GitHub returned ${res.status}` }; }
      const data = await res.json() as unknown[];
      releasesCache.set('data', data);
      return { success: true, data };
    } catch (err) {
      reply.status(502);
      return { success: false, error: (err as Error).message };
    }
  });
});
