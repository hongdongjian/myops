import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { claudeAssetsModule } from './routes.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): { deps: Deps; tmp: string; home: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cassets-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cassets-rt-home-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'conf', 'claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'conf', 'claude', 'rules', 'foo.md'), '# rule foo');
  fs.writeFileSync(
    path.join(tmp, 'conf', 'skill-presets.yaml'),
    `- name: alpha\n  desc: A\n  repo: https://example.com/x\n`,
  );
  const paths: Paths = {
    rootDir: tmp,
    homeDir: home,
    dataPath: (...p) => path.join(tmp, 'data', ...p),
    confPath: (...p) => path.join(tmp, 'conf', ...p),
    claudePath: (...p) => path.join(home, '.claude', ...p),
    codexPath: (...p) => path.join(home, '.codex', ...p),
  };
  const runner = {
    async run() { return { stdout: '', stderr: '', code: 0 }; },
  };
  return {
    deps: {
      config: { port: 0, models: [] } as any,
      paths,
      runner: runner as any,
      store: {} as any,
      processMgr: {} as any,
    },
    tmp,
    home,
  };
}

async function buildTestApp(deps?: Deps): Promise<{ app: any; deps: Deps }> {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  const { deps: built } = makeDeps();
  const realDeps = deps ?? built;
  await app.register(claudeAssetsModule, { deps: realDeps });
  return { app, deps: realDeps };
}

describe('claude assets routes', () => {
  it('GET /api/claude/rules/list returns rule items', async () => {
    const { app } = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/claude/rules/list' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.rules[0].name).toBe('foo.md');
  });

  it('POST /api/claude/rules/install creates a symlink', async () => {
    const { app, deps } = await buildTestApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/claude/rules/install',
      payload: { name: 'foo.md' },
    });
    expect(r.statusCode).toBe(200);
    expect(fs.existsSync(path.join(deps.paths.claudePath('rules'), 'foo.md'))).toBe(true);
  });

  it('GET /api/claude/rules/content returns file content', async () => {
    const { app } = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/claude/rules/content?name=foo.md' });
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('foo.md');
    expect(body.data.content).toBe('# rule foo');
  });

  it('POST /api/claude/rules/install rejects path traversal', async () => {
    const { app } = await buildTestApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/claude/rules/install',
      payload: { name: '../etc/passwd' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/invalid name/);
  });

  it('GET /api/claude/skills/list reflects preset', async () => {
    const { app } = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/claude/skills/list' });
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.skills[0].name).toBe('alpha');
    expect(body.data.skills[0].installed).toBe(false);
  });
});
