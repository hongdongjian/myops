import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { ClaudeAssetsService } from './service.js';
import {
  AssetActionRequestSchema,
  SkillPresetCreateRequestSchema,
  SkillPresetUpdateRequestSchema,
  SkillPresetDeleteRequestSchema,
  RuleCreateRequestSchema,
  RuleUpdateRequestSchema,
  RuleDeleteRequestSchema,
  type ApiEnvelope,
} from './schema.js';

interface PluginOptions {
  deps: Deps;
}

export const claudeAssetsModule = fp<PluginOptions>(async (app, opts) => {
  const service = new ClaudeAssetsService(opts.deps);

  // ── skills ────────────────────────────────────────────────────────────────

  app.get('/api/claude/skills/list', async (): Promise<ApiEnvelope> => {
    const [skills, others] = await Promise.all([service.listSkills(), service.listOtherSkills()]);
    return { success: true, data: { skills, others } };
  });

  app.post('/api/claude/skills/install', async (req): Promise<ApiEnvelope> => {
    const body = AssetActionRequestSchema.parse(req.body);
    await service.startSkillInstall(body.name);
    return { success: true, message: `skill ${body.name} install started` };
  });

  app.post('/api/claude/skills/uninstall', async (req): Promise<ApiEnvelope> => {
    const body = AssetActionRequestSchema.parse(req.body);
    await service.startSkillUninstall(body.name);
    return { success: true, message: `skill ${body.name} uninstall started` };
  });

  app.post('/api/claude/skills/update', async (): Promise<ApiEnvelope> => {
    const message = await service.updateSkills();
    return { success: true, message };
  });

  app.post('/api/claude/skills/update-single', async (req): Promise<ApiEnvelope> => {
    const body = AssetActionRequestSchema.parse(req.body);
    await service.startSkillUpdate(body.name);
    return { success: true, message: `skill ${body.name} update started` };
  });

  app.get<{ Querystring: { name?: string } }>('/api/claude/skills/content', async (req): Promise<ApiEnvelope> => {
    const name = (req.query.name ?? '').trim();
    const content = await service.getSkillContent(name);
    return { success: true, data: { name, content } };
  });

  // ── skills preset CRUD ────────────────────────────────────────────────────

  app.post('/api/claude/skills/preset/create', async (req): Promise<ApiEnvelope> => {
    const body = SkillPresetCreateRequestSchema.parse(req.body);
    await service.createSkillPreset(body);
    return { success: true };
  });

  app.post('/api/claude/skills/preset/update', async (req): Promise<ApiEnvelope> => {
    const body = SkillPresetUpdateRequestSchema.parse(req.body);
    await service.updateSkillPreset(body);
    return { success: true };
  });

  app.post('/api/claude/skills/preset/delete', async (req): Promise<ApiEnvelope> => {
    const body = SkillPresetDeleteRequestSchema.parse(req.body);
    await service.deleteSkillPreset(body.name);
    return { success: true };
  });

  // ── rules ─────────────────────────────────────────────────────────────────

  app.get('/api/claude/rules/list', async (): Promise<ApiEnvelope> => {
    const rules = await service.listRules();
    return { success: true, data: { rules } };
  });

  app.post('/api/claude/rules/create', async (req): Promise<ApiEnvelope> => {
    const body = RuleCreateRequestSchema.parse(req.body);
    await service.createRule(body);
    return { success: true };
  });

  app.post('/api/claude/rules/update', async (req): Promise<ApiEnvelope> => {
    const body = RuleUpdateRequestSchema.parse(req.body);
    await service.updateRuleContent(body);
    return { success: true };
  });

  app.post('/api/claude/rules/delete', async (req): Promise<ApiEnvelope> => {
    const body = RuleDeleteRequestSchema.parse(req.body);
    await service.deleteRule(body.name);
    return { success: true };
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
