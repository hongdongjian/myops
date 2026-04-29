import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { CopilotService } from './service.js';
import {
  ConfigSaveRequestSchema,
  AutostartSetRequestSchema,
  ProxySetRequestSchema,
  LogsQuerySchema,
  type ApiEnvelope,
} from './schema.js';

interface CopilotPluginOptions {
  deps: Deps;
}

export const copilotModule = fp<CopilotPluginOptions>(async (app, opts) => {
  const service = new CopilotService(opts.deps);

  app.get('/api/copilot/status', async (): Promise<ApiEnvelope> => {
    const data = await service.getStatus();
    return { success: true, data };
  });

  app.post('/api/copilot/start', async (): Promise<ApiEnvelope> => {
    try {
      const status = await service.startProcess();
      service.appendEventLog('START', `copilot-api started (pid=${status.pid})`);
      service.appendEventLog('RUN', 'process output stream attached');
      return { success: true, message: 'copilot-api started', data: status };
    } catch (err) {
      service.appendEventLog('START_ERROR', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  app.post('/api/copilot/stop', async (): Promise<ApiEnvelope> => {
    const stopped = await service.stopProcess();
    if (stopped) {
      service.appendEventLog('STOP', 'copilot-api stopped by console action');
      return { success: true, message: 'copilot-api stopped' };
    }
    service.appendEventLog('STOP_SKIP', 'stop requested but service was not running');
    return { success: true, message: 'copilot-api process was not running' };
  });

  app.post('/api/copilot/restart', async (): Promise<ApiEnvelope> => {
    const status = await service.restart();
    return { success: true, message: 'copilot-api restarted', data: status };
  });

  app.post('/api/copilot/upgrade', async (_req, reply): Promise<ApiEnvelope> => {
    const result = await service.upgrade();
    if (!result.success) reply.status(500);
    return result;
  });

  app.get('/api/copilot/logs', async (req): Promise<ApiEnvelope> => {
    const { lines } = LogsQuerySchema.parse(req.query ?? {});
    const data = await service.readLogs(lines);
    if (data.content === '' && (await isLogMissing(service))) {
      return { success: true, message: 'log file does not exist yet', data };
    }
    return { success: true, data };
  });

  app.post('/api/copilot/logs/clear', async (): Promise<ApiEnvelope> => {
    await service.clearLogs();
    return { success: true, message: 'copilot-api logs cleared' };
  });

  app.get('/api/copilot/usage', async (): Promise<ApiEnvelope> => {
    const usage = await service.fetchUsage();
    return { success: true, data: usage };
  });

  app.get('/api/copilot/config', async (): Promise<ApiEnvelope> => {
    const data = await service.readConfig();
    if (data.message) {
      const { message, ...rest } = data;
      return { success: true, message, data: rest };
    }
    return { success: true, data };
  });

  app.post('/api/copilot/config/save', async (req): Promise<ApiEnvelope> => {
    const body = ConfigSaveRequestSchema.parse(req.body);
    const data = await service.saveConfig(body.content);
    return { success: true, message: 'copilot config saved', data };
  });

  app.get('/api/copilot/config/sync-status', async (): Promise<ApiEnvelope> => {
    const data = await service.configSyncStatus();
    return { success: true, data };
  });

  app.post('/api/copilot/config/sync', async (): Promise<ApiEnvelope> => {
    await service.configSync();
    return { success: true, message: '配置已同步' };
  });

  app.get('/api/copilot/autostart', async (): Promise<ApiEnvelope> => {
    return { success: true, data: service.getAutostart() };
  });

  app.post('/api/copilot/autostart/set', async (req): Promise<ApiEnvelope> => {
    const body = AutostartSetRequestSchema.parse(req.body);
    const data = await service.setAutostart(body.enabled);
    return { success: true, data };
  });

  app.get('/api/copilot/source', async (): Promise<ApiEnvelope> => {
    return { success: true, data: service.getSource() };
  });

  app.get('/api/copilot/proxy', async (): Promise<ApiEnvelope> => {
    return { success: true, data: service.getProxy() };
  });

  app.post('/api/copilot/proxy/set', async (req): Promise<ApiEnvelope> => {
    const body = ProxySetRequestSchema.parse(req.body);
    const data = await service.setProxy(body.enabled);
    return { success: true, data };
  });
});

async function isLogMissing(service: CopilotService): Promise<boolean> {
  const fs = await import('node:fs/promises');
  try {
    await fs.access(service.logPath());
    return false;
  } catch {
    return true;
  }
}
