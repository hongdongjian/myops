import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { ClaudeSettingsService } from './service.js';
import {
  SettingsSaveRequestSchema,
  AutoCompactSetRequestSchema,
  RenderModelEnvSetRequestSchema,
  SettingsTemplateSaveRequestSchema,
  PowerlineSaveRequestSchema,
  type ApiEnvelope,
} from './schema.js';

interface PluginOptions {
  deps: Deps;
}

export const claudeSettingsModule = fp<PluginOptions>(async (app, opts) => {
  const service = new ClaudeSettingsService(opts.deps);

  app.get('/api/claude/settings', async (): Promise<ApiEnvelope> => {
    const data = await service.getSettings();
    return { success: true, data };
  });

  app.post('/api/claude/settings/save', async (req): Promise<ApiEnvelope> => {
    const body = SettingsSaveRequestSchema.parse(req.body ?? {});
    await service.saveSettings(body);
    return { success: true, message: 'settings saved' };
  });

  app.post('/api/claude/settings/auto-compact/set', async (req): Promise<ApiEnvelope> => {
    const body = AutoCompactSetRequestSchema.parse(req.body);
    await service.setAutoCompact(body.enabled);
    return { success: true, data: { enabled: body.enabled } };
  });

  app.post('/api/claude/settings/render-model-env/set', async (req): Promise<ApiEnvelope> => {
    const body = RenderModelEnvSetRequestSchema.parse(req.body);
    await service.setRenderModelEnv(body.enabled);
    return { success: true, data: { enabled: body.enabled } };
  });

  app.get('/api/claude/settings/template', async (): Promise<ApiEnvelope> => {
    const data = await service.getTemplate();
    return { success: true, data };
  });

  app.post('/api/claude/settings/template/save', async (req): Promise<ApiEnvelope> => {
    const body = SettingsTemplateSaveRequestSchema.parse(req.body);
    await service.saveTemplate(body.content);
    return { success: true, message: 'template saved' };
  });

  app.get('/api/claude/onboarding', async (): Promise<ApiEnvelope> => {
    const data = await service.getOnboarding();
    return { success: true, data };
  });

  app.post('/api/claude/onboarding/skip', async (): Promise<ApiEnvelope> => {
    await service.skipOnboarding();
    return { success: true, message: 'onboarding skipped' };
  });

  app.get('/api/claude/powerline', async (): Promise<ApiEnvelope> => {
    const data = await service.getPowerline();
    return { success: true, data };
  });

  app.post('/api/claude/powerline/save', async (req): Promise<ApiEnvelope> => {
    const body = PowerlineSaveRequestSchema.parse(req.body);
    await service.savePowerline(body.content);
    return { success: true, message: 'powerline config saved' };
  });
});
