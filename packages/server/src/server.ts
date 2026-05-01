import Fastify, { type FastifyInstance } from 'fastify';
import staticPlugin from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { copilotModule } from './modules/copilot/routes.js';
import { copilotAccountsModule } from './modules/copilot-accounts/routes.js';
import { mcpModule } from './modules/mcp/routes.js';
import { claudeSettingsModule } from './modules/claude-settings/routes.js';
import { claudeMCPModule } from './modules/claude-mcp/routes.js';
import { claudeAssetsModule } from './modules/claude-assets/routes.js';
import { claudeInstructionsModule } from './modules/claude-instructions/routes.js';
import { claudeProvidersModule } from './modules/claude-providers/routes.js';
import { claudeVersionModule } from './modules/claude-version/routes.js';
import { claudePluginModule } from './modules/claude-plugin/routes.js';
import { codexVersionModule } from './modules/codex-version/routes.js';
import { codexAccountsModule } from './modules/codex-accounts/routes.js';
import { codexAgentsModule } from './modules/codex-agents/routes.js';
import { codexAssetsModule } from './modules/codex-assets/routes.js';
import { codexMCPModule } from './modules/codex-mcp/routes.js';
import { codexSettingsModule } from './modules/codex-settings/routes.js';
import { codexProvidersModule } from './modules/codex-providers/routes.js';
import { schedulerModule } from './modules/scheduler/routes.js';
import { clashModule } from './modules/clash/routes.js';
import { fsModule } from './modules/fs/routes.js';
import type { Deps } from './deps.js';

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' } });
  await app.register(errorHandlerPlugin);

  app.get('/api/health', async () => ({ ok: true }));

  if (deps.copilotAccounts) {
    await app.register(copilotAccountsModule, { deps });
  }
  await app.register(copilotModule, { deps });
  await app.register(mcpModule, { deps });
  await app.register(claudeSettingsModule, { deps });
  await app.register(claudeMCPModule, { deps });
  await app.register(claudeAssetsModule, { deps });
  await app.register(claudeInstructionsModule, { deps });
  await app.register(claudeProvidersModule, { deps });
  await app.register(claudeVersionModule, { deps });
  await app.register(claudePluginModule, { deps });
  await app.register(codexVersionModule, { deps });
  await app.register(codexAccountsModule, { deps });
  await app.register(codexAgentsModule, { deps });
  await app.register(codexAssetsModule, { deps });
  await app.register(codexMCPModule, { deps });
  await app.register(codexSettingsModule, { deps });
  await app.register(codexProvidersModule, { deps });
  await app.register(schedulerModule, { deps });
  await app.register(clashModule, { deps });
  await app.register(fsModule);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.join(here, 'public');
  if (fs.existsSync(publicDir)) {
    await app.register(staticPlugin, { root: publicDir, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.status(404).send({ success: false, error: 'not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  return app;
}
