import Fastify, { type FastifyInstance } from 'fastify';
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
import type { Deps } from './deps.js';

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' } });
  await app.register(errorHandlerPlugin);

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/server/models', async () => ({ models: deps.config.models }));

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

  return app;
}
