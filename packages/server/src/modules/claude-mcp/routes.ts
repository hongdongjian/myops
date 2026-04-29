import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { ClaudeMCPService } from './service.js';
import {
  MCPAddRequestSchema,
  MCPRemoveRequestSchema,
  MCPPresetActionRequestSchema,
  type ApiEnvelope,
} from './schema.js';

interface PluginOptions {
  deps: Deps;
}

export const claudeMCPModule = fp<PluginOptions>(async (app, opts) => {
  const service = new ClaudeMCPService(opts.deps);

  app.get('/api/claude/mcp/list', async (): Promise<ApiEnvelope> => {
    const data = await service.list();
    return { success: true, data };
  });

  app.post('/api/claude/mcp/add', async (req, reply): Promise<ApiEnvelope> => {
    const body = MCPAddRequestSchema.parse(req.body);
    const r = await service.add(body.name, body.transport, body.target);
    if (!r.ok) reply.status(500);
    return { success: r.ok, error: r.ok ? undefined : r.error, data: { stdout: r.stdout, stderr: r.stderr } };
  });

  app.post('/api/claude/mcp/remove', async (req, reply): Promise<ApiEnvelope> => {
    const body = MCPRemoveRequestSchema.parse(req.body);
    const r = await service.remove(body.name);
    if (!r.ok) reply.status(500);
    return { success: r.ok, error: r.ok ? undefined : r.error, data: { stdout: r.stdout, stderr: r.stderr } };
  });

  app.post('/api/claude/mcp/preset/install', async (req, reply): Promise<ApiEnvelope> => {
    const body = MCPPresetActionRequestSchema.parse(req.body);
    const r = await service.presetInstall(body.name, body.scope);
    if (!r.ok) reply.status(500);
    return {
      success: r.ok,
      error: r.ok ? undefined : r.error,
      data: { name: r.name, scope: r.scope, stdout: r.stdout, stderr: r.stderr },
    };
  });

  app.post('/api/claude/mcp/preset/remove', async (req, reply): Promise<ApiEnvelope> => {
    const body = MCPPresetActionRequestSchema.parse(req.body);
    const r = await service.presetRemove(body.name, body.scope);
    if (!r.ok) reply.status(500);
    return {
      success: r.ok,
      error: r.ok ? undefined : r.error,
      data: { name: r.name, scope: r.scope, stdout: r.stdout, stderr: r.stderr },
    };
  });
});
