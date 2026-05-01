import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { CodexSettingsService } from './service.js';
import {
  CodexAuthModeSetRequestSchema,
  CodexSettingsSaveRequestSchema,
  CodexSettingsTemplateSaveRequestSchema,
  type ApiEnvelope,
} from './schema.js';

interface PluginOptions {
  deps: Deps;
}

export const codexSettingsModule = fp<PluginOptions>(async (app, opts) => {
  const service = new CodexSettingsService(opts.deps);

  app.get('/api/codex/settings', async (): Promise<ApiEnvelope> => {
    const data = await service.getSettings();
    return { success: true, data };
  });

  app.post('/api/codex/settings/save', async (req): Promise<ApiEnvelope> => {
    const body = CodexSettingsSaveRequestSchema.parse(req.body ?? {});
    await service.saveSettings(body);
    return { success: true, message: 'codex settings saved' };
  });

  app.post('/api/codex/settings/auth-mode/set', async (req): Promise<ApiEnvelope> => {
    const body = CodexAuthModeSetRequestSchema.parse(req.body ?? {});
    await service.setAuthMode(body);
    return { success: true, message: 'auth mode updated' };
  });

  app.get('/api/codex/settings/template', async (): Promise<ApiEnvelope> => {
    const data = await service.getTemplate();
    return { success: true, data };
  });

  app.get('/api/codex/settings/template/sync-status', async (): Promise<ApiEnvelope> => {
    const data = await service.templateSyncStatus();
    return { success: true, data };
  });

  app.post('/api/codex/settings/template/save', async (req): Promise<ApiEnvelope> => {
    const body = CodexSettingsTemplateSaveRequestSchema.parse(req.body ?? {});
    await service.saveTemplate(body.content);
    return { success: true, message: 'codex template saved' };
  });
});
