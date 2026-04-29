import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { CodexMCPService } from './service.js';
import { CodexMCPPresetActionRequestSchema, type ApiEnvelope } from './schema.js';

interface PluginOptions {
  deps: Deps;
}

export const codexMCPModule = fp<PluginOptions>(async (app, opts) => {
  const service = new CodexMCPService(opts.deps);

  app.get('/api/codex/mcp/list', async (): Promise<ApiEnvelope> => {
    const data = await service.list();
    return { success: true, data };
  });

  app.post('/api/codex/mcp/preset/install', async (req, reply): Promise<ApiEnvelope> => {
    const body = CodexMCPPresetActionRequestSchema.parse(req.body ?? {});
    const result = await service.presetInstall(body.name);
    if (!result.ok) reply.code(500);
    return {
      success: result.ok,
      data: { name: result.name, stdout: result.stdout, stderr: result.stderr },
      error: result.ok ? undefined : { code: 'CODEX_MCP_INSTALL_FAILED', message: result.error },
    };
  });

  app.post('/api/codex/mcp/preset/remove', async (req, reply): Promise<ApiEnvelope> => {
    const body = CodexMCPPresetActionRequestSchema.parse(req.body ?? {});
    const result = await service.presetRemove(body.name);
    if (!result.ok) reply.code(500);
    return {
      success: result.ok,
      data: { name: result.name, stdout: result.stdout, stderr: result.stderr },
      error: result.ok ? undefined : { code: 'CODEX_MCP_REMOVE_FAILED', message: result.error },
    };
  });
});
