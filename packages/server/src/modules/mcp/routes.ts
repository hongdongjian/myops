import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { XHSService, parseLinesParameter } from './service.js';
import {
  CopyPackageRequestSchema,
  AutostartSetRequestSchema,
  LogsQuerySchema,
  type ApiEnvelope,
} from './schema.js';

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

  app.post('/api/mcp/xiaohongshu/copy-package', async (req): Promise<ApiEnvelope> => {
    const body = CopyPackageRequestSchema.parse(req.body ?? {});
    const data = await service.copyPackage(body.sourcePath);
    return { success: true, message: 'xiaohongshu mcp package copied', data };
  });

  app.post('/api/mcp/xiaohongshu/register', async (_req, reply): Promise<ApiEnvelope> => {
    const r = await service.registerToClaude();
    if (!r.ok) reply.status(500);
    return {
      success: r.ok,
      error: r.ok ? undefined : r.error,
      data: { stdout: r.stdout, stderr: r.stderr },
    };
  });

  app.get('/api/mcp/xiaohongshu/autostart', async (): Promise<ApiEnvelope> => {
    return { success: true, data: service.getAutostart() };
  });

  app.post('/api/mcp/xiaohongshu/autostart/set', async (req): Promise<ApiEnvelope> => {
    const body = AutostartSetRequestSchema.parse(req.body);
    const data = await service.setAutostart(body.enabled);
    return { success: true, data };
  });
});
