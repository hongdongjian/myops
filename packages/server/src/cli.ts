#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createPaths } from './paths.js';
import { loadConfig } from './config/loader.js';
import { Runner } from './core/system/runner.js';
import { StateStore } from './core/process/state.js';
import { ProcessManager } from './core/process/manager.js';
import { buildApp } from './server.js';
import { CopilotAccountsService } from './modules/copilot-accounts/service.js';

const program = new Command();
program.name('my-ops').version('0.1.0');

program
  .option('-p, --port <number>', 'override port', (v) => parseInt(v, 10))
  .option('-r, --root <dir>', 'root directory (default: ~/.my-ops or cwd in dev)')
  .action(async (opts) => {
    const rootDir = resolveRoot(opts.root);
    ensureUserData(rootDir);
    const paths = createPaths(rootDir);
    const config = loadConfig(paths.confPath('server.yaml'));
    const port = opts.port ?? config.port;
    const store = new StateStore(paths.dataPath('state.json'));
    const processMgr = new ProcessManager(store, paths.dataPath('logs'));
    const runner = new Runner();
    const copilotAccounts = new CopilotAccountsService(paths);
    const app = await buildApp({ config, paths, runner, store, processMgr, copilotAccounts });
    await app.listen({ port, host: '127.0.0.1' });
  });

program.command('version').action(() => console.log('0.1.0'));
program.command('doctor').action(() => {
  console.log('node:', process.version);
  console.log('platform:', os.platform());
});

program.parseAsync().catch((e) => {
  console.error(e);
  process.exit(1);
});

function resolveRoot(opt: string | undefined): string {
  if (opt) return path.resolve(opt);
  if (process.env.MY_OPS_DEV === '1') return process.cwd();
  return path.join(os.homedir(), '.my-ops');
}

function ensureUserData(rootDir: string): void {
  const conf = path.join(rootDir, 'conf', 'server.yaml');
  if (fs.existsSync(conf)) return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const template = path.resolve(here, '..', 'conf');
  if (!fs.existsSync(template)) return;
  fs.mkdirSync(path.join(rootDir, 'conf'), { recursive: true });
  copyDirSync(template, path.join(rootDir, 'conf'));
}

function copyDirSync(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}
