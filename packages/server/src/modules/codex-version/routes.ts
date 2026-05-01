import fp from 'fastify-plugin';
import NodeCache from 'node-cache';
import { fetch, EnvHttpProxyAgent } from 'undici';
import type { Deps } from '../../deps.js';
import { CodexVersionService, type CodexUpgradeHooks } from './service.js';
import type { ApiEnvelope } from './schema.js';

const RELEASES_URL = 'https://api.github.com/repos/openai/codex/releases';
const releasesCache = new NodeCache({ stdTTL: 5 * 60 });
const proxyAgent = new EnvHttpProxyAgent();

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
}

interface PluginOptions {
  deps: Deps;
  hooks?: CodexUpgradeHooks;
}

export const codexVersionModule = fp<PluginOptions>(async (app, opts) => {
  const service = new CodexVersionService(opts.deps, opts.hooks);

  app.get('/api/codex/version', async (): Promise<ApiEnvelope> => {
    const data = await service.getStatus();
    return { success: true, data };
  });

  app.post('/api/codex/upgrade', async (_req, reply): Promise<ApiEnvelope> => {
    const result = await service.upgrade();
    if (!result.ok) {
      reply.status(500);
      return { success: false, error: result.message, data: result.payload };
    }
    return { success: true, message: result.message, data: result.payload };
  });

  app.get('/api/codex/changelog', async (_req, reply): Promise<ApiEnvelope> => {
    const cached = releasesCache.get<GitHubRelease[]>('releases');
    if (cached !== undefined) {
      return { success: true, data: { releases: cached } };
    }
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'myops-server/1.0',
        Accept: 'application/vnd.github.v3+json',
      };
      const token = process.env.GITHUB_API_TOKEN;
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(RELEASES_URL, { dispatcher: proxyAgent, headers });
      if (!res.ok) {
        reply.status(502);
        return { success: false, error: `GitHub returned ${res.status}` };
      }
      const releases = await res.json() as GitHubRelease[];
      releasesCache.set('releases', releases);
      return { success: true, data: { releases } };
    } catch (err) {
      reply.status(502);
      return { success: false, error: (err as Error).message };
    }
  });
});
