import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { copilotModule } from './modules/copilot/routes.js';
import type { Deps } from './deps.js';

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' } });
  await app.register(errorHandlerPlugin);

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/server/models', async () => ({ models: deps.config.models }));

  await app.register(copilotModule, { deps });

  return app;
}
