import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { CodexAssetsService } from './service.js';
import { SkillActionRequestSchema, type ApiEnvelope } from './schema.js';

interface PluginOptions {
  deps: Deps;
}

export const codexAssetsModule = fp<PluginOptions>(async (app, opts) => {
  const service = new CodexAssetsService(opts.deps);

  app.get('/api/codex/skills/list', async (): Promise<ApiEnvelope> => {
    const skills = service.listSkills();
    return { success: true, data: { skills } };
  });

  app.post('/api/codex/skills/install', async (req): Promise<ApiEnvelope> => {
    const body = SkillActionRequestSchema.parse(req.body);
    service.startSkillInstall(body.name);
    return { success: true, message: `skill ${body.name} install started` };
  });

  app.post('/api/codex/skills/uninstall', async (req): Promise<ApiEnvelope> => {
    const body = SkillActionRequestSchema.parse(req.body);
    service.startSkillUninstall(body.name);
    return { success: true, message: `skill ${body.name} uninstall started` };
  });

  app.post('/api/codex/skills/update', async (): Promise<ApiEnvelope> => {
    const message = await service.updateSkills();
    return { success: true, message };
  });

  app.get<{ Querystring: { name?: string } }>('/api/codex/skills/content', async (req): Promise<ApiEnvelope> => {
    const name = (req.query.name ?? '').trim();
    const content = await service.getSkillContent(name);
    return { success: true, data: { name, content } };
  });
});
