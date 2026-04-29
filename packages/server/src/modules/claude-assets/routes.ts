import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { ClaudeAssetsService } from './service.js';
import { AssetActionRequestSchema, type ApiEnvelope } from './schema.js';

interface PluginOptions {
  deps: Deps;
}

export const claudeAssetsModule = fp<PluginOptions>(async (app, opts) => {
  const service = new ClaudeAssetsService(opts.deps);

  // ── skills ────────────────────────────────────────────────────────────────

  app.get('/api/claude/skills/list', async (): Promise<ApiEnvelope> => {
    const skills = service.listSkills();
    return { success: true, data: { skills } };
  });

  app.post('/api/claude/skills/install', async (req): Promise<ApiEnvelope> => {
    const body = AssetActionRequestSchema.parse(req.body);
    service.startSkillInstall(body.name);
    return { success: true, message: `skill ${body.name} install started` };
  });

  app.post('/api/claude/skills/uninstall', async (req): Promise<ApiEnvelope> => {
    const body = AssetActionRequestSchema.parse(req.body);
    service.startSkillUninstall(body.name);
    return { success: true, message: `skill ${body.name} uninstall started` };
  });

  app.post('/api/claude/skills/update', async (): Promise<ApiEnvelope> => {
    const message = await service.updateSkills();
    return { success: true, message };
  });

  app.get<{ Querystring: { name?: string } }>('/api/claude/skills/content', async (req): Promise<ApiEnvelope> => {
    const name = (req.query.name ?? '').trim();
    const content = await service.getSkillContent(name);
    return { success: true, data: { name, content } };
  });

  // ── rules ─────────────────────────────────────────────────────────────────

  app.get('/api/claude/rules/list', async (): Promise<ApiEnvelope> => {
    const rules = await service.listRules();
    return { success: true, data: { rules } };
  });

  app.post('/api/claude/rules/install', async (req): Promise<ApiEnvelope> => {
    const body = AssetActionRequestSchema.parse(req.body);
    await service.installRule(body.name);
    return { success: true, message: `rule ${body.name} installed` };
  });

  app.post('/api/claude/rules/uninstall', async (req): Promise<ApiEnvelope> => {
    const body = AssetActionRequestSchema.parse(req.body);
    await service.uninstallRule(body.name);
    return { success: true, message: `rule ${body.name} uninstalled` };
  });

  app.get<{ Querystring: { name?: string } }>('/api/claude/rules/content', async (req): Promise<ApiEnvelope> => {
    const name = (req.query.name ?? '').trim();
    const content = await service.getRuleContent(name);
    return { success: true, data: { name, content } };
  });
});
