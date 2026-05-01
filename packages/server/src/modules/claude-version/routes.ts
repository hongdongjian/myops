import fp from 'fastify-plugin';
import NodeCache from 'node-cache';
import { fetch, EnvHttpProxyAgent } from 'undici';
import type { Deps } from '../../deps.js';
import { ClaudeVersionService } from './service.js';
import type { ApiEnvelope } from './schema.js';

const CHANGELOG_URL =
  'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md';
const changelogCache = new NodeCache({ stdTTL: 5 * 60 });
const proxyAgent = new EnvHttpProxyAgent();

interface PluginOptions {
  deps: Deps;
}

export const claudeVersionModule = fp<PluginOptions>(async (app, opts) => {
  const service = new ClaudeVersionService(opts.deps);

  app.get('/api/claude/version', async (): Promise<ApiEnvelope> => {
    const data = await service.getStatus();
    return { success: true, data };
  });

  app.post('/api/claude/upgrade', async (_req, reply): Promise<ApiEnvelope> => {
    try {
      const result = await service.upgrade();
      if (!result.ok) {
        reply.status(500);
        return {
          success: false,
          error: result.message,
          data: result.payload,
        };
      }
      return { success: true, message: result.message, data: result.payload };
    } catch (err) {
      // bubble AppError to error handler
      throw err;
    }
  });

  app.get('/api/claude/changelog', async (_req, reply): Promise<ApiEnvelope> => {
    const cached = changelogCache.get<string>('content');
    if (cached !== undefined) {
      return { success: true, data: { content: cached } };
    }
    try {
      const res = await fetch(CHANGELOG_URL, { dispatcher: proxyAgent });
      if (!res.ok) {
        reply.status(502);
        return { success: false, error: `GitHub returned ${res.status}` };
      }
      const content = await res.text();
      changelogCache.set('content', content);
      return { success: true, data: { content } };
    } catch (err) {
      reply.status(502);
      return { success: false, error: (err as Error).message };
    }
  });
});
