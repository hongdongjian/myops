import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { ClaudePluginService } from './service.js';
import { PluginActionRequestSchema, AddPresetRequestSchema, UpdatePresetRequestSchema, RemovePresetRequestSchema, type ApiEnvelope } from './schema.js';

interface PluginOptions {
  deps: Deps;
}

export const claudePluginModule = fp<PluginOptions>(async (app, opts) => {
  const service = new ClaudePluginService(opts.deps);

  app.get('/api/claude/plugins', async (): Promise<ApiEnvelope> => {
    const data = await service.list();
    return { success: true, data };
  });

  app.post('/api/claude/plugins/install', async (req, reply): Promise<ApiEnvelope> => {
    const body = PluginActionRequestSchema.parse(req.body ?? {});
    const r = await service.install(body.package);
    if (!r.ok) reply.status(500);
    return {
      success: r.ok,
      error: r.ok ? undefined : r.error,
      data: { package: r.package, scope: r.scope, stdout: r.stdout, stderr: r.stderr },
    };
  });

  app.post('/api/claude/plugins/enable', async (req, reply): Promise<ApiEnvelope> => {
    const body = PluginActionRequestSchema.parse(req.body ?? {});
    const r = await service.enable(body.package);
    if (!r.ok) reply.status(500);
    return {
      success: r.ok,
      error: r.ok ? undefined : r.error,
      data: { package: r.package, scope: r.scope, stdout: r.stdout, stderr: r.stderr },
    };
  });

  app.post('/api/claude/plugins/disable', async (req, reply): Promise<ApiEnvelope> => {
    const body = PluginActionRequestSchema.parse(req.body ?? {});
    const r = await service.disable(body.package);
    if (!r.ok) reply.status(500);
    return {
      success: r.ok,
      error: r.ok ? undefined : r.error,
      data: { package: r.package, scope: r.scope, stdout: r.stdout, stderr: r.stderr },
    };
  });

  app.post('/api/claude/plugins/update', async (req, reply): Promise<ApiEnvelope> => {
    const body = PluginActionRequestSchema.parse(req.body ?? {});
    const r = await service.update(body.package);
    if (!r.ok) reply.status(500);
    return {
      success: r.ok,
      error: r.ok ? undefined : r.error,
      data: { package: r.package, scope: r.scope, stdout: r.stdout, stderr: r.stderr },
    };
  });

  app.post('/api/claude/plugins/uninstall', async (req, reply): Promise<ApiEnvelope> => {
    const body = PluginActionRequestSchema.parse(req.body ?? {});
    const r = await service.uninstall(body.package);
    if (!r.ok) reply.status(500);
    return {
      success: r.ok,
      error: r.ok ? undefined : r.error,
      data: { package: r.package, scope: r.scope, stdout: r.stdout, stderr: r.stderr },
    };
  });

  app.post('/api/claude/plugins/add-preset', async (req): Promise<ApiEnvelope> => {
    const body = AddPresetRequestSchema.parse(req.body ?? {});
    await service.addPreset(body);
    return { success: true, message: 'preset added' };
  });

  app.post('/api/claude/plugins/update-preset', async (req): Promise<ApiEnvelope> => {
    const body = UpdatePresetRequestSchema.parse(req.body ?? {});
    await service.updatePreset(body);
    return { success: true, message: 'preset updated' };
  });

  app.post('/api/claude/plugins/remove-preset', async (req): Promise<ApiEnvelope> => {
    const body = RemovePresetRequestSchema.parse(req.body ?? {});
    await service.removePreset(body.package);
    return { success: true, message: 'preset removed' };
  });
});
