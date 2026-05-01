#!/usr/bin/env node
import { Command } from 'commander';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createPaths } from './paths.js';
import { Runner } from './core/system/runner.js';
import { StateStore } from './core/process/state.js';
import { ProcessManager } from './core/process/manager.js';

const _require = createRequire(import.meta.url);
const PKG_VERSION: string = (_require('../package.json') as { version: string }).version;
import { buildApp } from './server.js';
import { CopilotAccountsService } from './modules/copilot-accounts/service.js';
import { startAutostartLoops, stopAutostartLoops } from './core/autostart.js';
import { ClaudeProvidersService } from './modules/claude-providers/service.js';
import { ConfigSyncService } from './modules/config-sync/service.js';

const PLIST_LABEL = 'com.hongdongjian.myops';
const PLIST_PATH = path.join(os.homedir(), 'Library/LaunchAgents', `${PLIST_LABEL}.plist`);

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generatePlist(nodeBin: string, cliPath: string, installDir: string, env: Record<string, string>): string {
  const envEntries = Object.entries(env)
    .map(([k, v]) => `    <key>${escapeXml(k)}</key><string>${escapeXml(v)}</string>`)
    .join('\n');
  const pathVal = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodeBin)}</string>
    <string>${escapeXml(cliPath)}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(installDir)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(path.join(installDir, 'data', 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(path.join(installDir, 'data', 'launchd.err.log'))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${escapeXml(pathVal)}</string>
${envEntries}
  </dict>
</dict>
</plist>`;
}

function promptLine(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function launchctlUnload(plistPath: string): void {
  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: 'ignore' });
  } catch {
    // not loaded — ignore
  }
}

function requireDarwin(): void {
  if (os.platform() !== 'darwin') {
    console.error('this command is only supported on macOS');
    process.exit(1);
  }
}

const DEFAULT_PORT = 3333;

const program = new Command();
program.name('myops').version(PKG_VERSION).helpOption('-h, --help', 'show help');

program
  .command('start')
  .description('start the myops server')
  .option('-p, --port <number>', 'port to listen on', (v) => parseInt(v, 10))
  .option('--github-token <token>', 'override GITHUB_API_TOKEN env var')
  .action(async (opts: { port?: number; githubToken?: string }) => {
    const rootDir = path.join(os.homedir(), '.myops');
    const paths = createPaths(rootDir);
    const port = opts.port ?? DEFAULT_PORT;
    if (opts.githubToken) process.env.GITHUB_API_TOKEN = opts.githubToken;
    const store = new StateStore(paths.dataPath('state.json'));
    const processMgr = new ProcessManager(store, paths.dataPath('logs'));
    const runner = new Runner();
    const copilotAccounts = new CopilotAccountsService(paths);
    const deps = { paths, runner, store, processMgr, copilotAccounts };
    const app = await buildApp(deps);
    await app.listen({ port, host: '127.0.0.1' });
    startAutostartLoops(deps);
    const shutdown = async () => {
      stopAutostartLoops();
      try {
        await app.close();
      } finally {
        process.exit(0);
      }
    };
    process.on('SIGTERM', () => void shutdown());
    process.on('SIGINT', () => void shutdown());
  });

program.command('version').description('print version').action(() => console.log(PKG_VERSION));

program.command('doctor').description('print diagnostic info').action(() => {
  console.log('node:', process.version);
  console.log('platform:', os.platform());

  if (os.platform() === 'darwin') {
    const plistExists = fs.existsSync(PLIST_PATH);
    console.log('plist:', PLIST_PATH);
    console.log('plist exists:', plistExists);

    if (plistExists) {
      try {
        const out = execSync(`launchctl list | grep "${PLIST_LABEL}"`, { encoding: 'utf8' }).trim();
        // launchctl list columns: PID  LastExit  Label
        const parts = out.split(/\s+/);
        const pid = parts[0];
        const lastExit = parts[1];
        const running = pid !== undefined && pid !== '-';
        console.log('service running:', running);
        if (running) console.log('service pid:', pid);
        if (!running && lastExit !== undefined && lastExit !== '0') {
          console.log('last exit code:', lastExit);
        }
      } catch {
        console.log('service running: false');
      }
    }
  }
});

program
  .command('ccenv [provider] [args...]')
  .description('run claude with provider env vars, or list providers')
  .allowUnknownOption()
  .action(async (provider?: string, args: string[] = []) => {
    const rootDir = path.join(os.homedir(), '.myops');
    const paths = createPaths(rootDir);
    const store = new StateStore(paths.dataPath('state.json'));
    const processMgr = new ProcessManager(store, paths.dataPath('logs'));
    const runner = new Runner();
    const svc = new ClaudeProvidersService({ paths, runner, store, processMgr });

    if (!provider || provider === 'list') {
      const data = await svc.list();
      if (data.providers.length === 0) {
        console.log('no providers configured');
        return;
      }
      for (const p of data.providers) {
        const marker = p.name === data.activeProvider ? ' *' : '';
        const sonnet = p.sonnetModel || p.model || '-';
        const opus = p.opusModel || p.model || '-';
        const haiku = p.haikuModel || '-';
        console.log(`${p.name}${marker}`);
        console.log(`  base:   ${p.baseUrl || '-'}`);
        console.log(`  sonnet: ${sonnet}`);
        console.log(`  opus:   ${opus}`);
        console.log(`  haiku:  ${haiku}`);
      }
      return;
    }

    const data = await svc.list();
    const found = data.providers.find((p) => p.name === provider);
    if (!found) {
      console.error(`provider not found: ${provider}`);
      process.exit(1);
    }

    const sonnet = found.sonnetModel || found.model;
    const opus = found.opusModel || found.model;

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (found.baseUrl) env.ANTHROPIC_BASE_URL = found.baseUrl;
    if (found.token) env.ANTHROPIC_AUTH_TOKEN = found.token;
    if (sonnet) env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
    if (opus) env.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
    if (found.haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = found.haikuModel;

    const child = spawn('claude', args, { env, stdio: 'inherit' });
    child.on('close', (code) => process.exit(code ?? 0));
  });

function makeConfigSvc(): ConfigSyncService {
  const rootDir = path.join(os.homedir(), '.myops');
  const paths = createPaths(rootDir);
  return new ConfigSyncService(paths, new Runner());
}

const configCmd = program.command('config').description('manage conf directory sync with GitHub');

configCmd
  .command('init <github-url>')
  .description('initialize conf directory sync with GitHub (repo must be empty or only contain README.md)')
  .option('--pull', 'clone remote repo into conf directory instead of pushing local')
  .option('--force-pull', 'delete existing conf directory and re-clone from remote')
  .action(async (githubUrl: string, opts: { pull?: boolean; forcePull?: boolean }) => {
    const svc = makeConfigSvc();
    try {
      if (opts.pull || opts.forcePull) {
        await svc.pull(githubUrl, opts.forcePull ?? false, (msg) => console.log(msg));
        console.log('conf directory cloned from GitHub successfully');
      } else {
        await svc.init(githubUrl, (msg) => console.log(msg));
        console.log('conf directory initialized and synced to GitHub');
      }
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

configCmd
  .command('upload')
  .description('upload conf directory to GitHub')
  .option('--force', 'force overwrite remote even if there are conflicts')
  .action(async (opts: { force?: boolean }) => {
    const svc = makeConfigSvc();
    try {
      await svc.upload(opts.force ?? false, (msg) => console.log(msg));
      console.log('conf directory uploaded successfully');
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

configCmd
  .command('update')
  .description('update conf directory from GitHub')
  .option('--force', 'discard all local changes before updating')
  .action(async (opts: { force?: boolean }) => {
    const svc = makeConfigSvc();
    try {
      await svc.update(opts.force ?? false, (msg) => console.log(msg));
      console.log('conf directory updated successfully');
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

program
  .command('install')
  .description('install myops as a launchd service (macOS only)')
  .action(async () => {
    requireDarwin();

    const installDir = path.join(os.homedir(), '.myops');
    const cliPath = fs.realpathSync(fileURLToPath(import.meta.url));
    const nodeBin = process.execPath;

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const githubToken = await promptLine(rl, 'GITHUB_API_TOKEN (press Enter to skip): ');
    const httpProxy = await promptLine(rl, 'HTTP_PROXY (press Enter to skip): ');
    const httpsProxy = await promptLine(rl, 'https_proxy (press Enter to skip): ');
    rl.close();

    const env: Record<string, string> = {};
    if (githubToken) env.GITHUB_API_TOKEN = githubToken;
    if (httpProxy) env.HTTP_PROXY = httpProxy;
    if (httpsProxy) env.https_proxy = httpsProxy;

    fs.mkdirSync(path.join(os.homedir(), 'Library/LaunchAgents'), { recursive: true });
    fs.mkdirSync(path.join(installDir, 'data'), { recursive: true });

    const plist = generatePlist(nodeBin, cliPath, installDir, env);
    fs.writeFileSync(PLIST_PATH, plist, 'utf8');

    launchctlUnload(PLIST_PATH);
    execSync(`launchctl load -w "${PLIST_PATH}"`, { stdio: 'inherit' });

    console.log('installed:', PLIST_PATH);
  });

program
  .command('uninstall')
  .description('uninstall myops launchd service (macOS only)')
  .action(() => {
    requireDarwin();

    if (!fs.existsSync(PLIST_PATH)) {
      console.log('not installed:', PLIST_PATH);
      return;
    }

    launchctlUnload(PLIST_PATH);
    fs.unlinkSync(PLIST_PATH);
    console.log('removed:', PLIST_PATH);
  });

program
  .command('restart')
  .description('restart myops launchd service (macOS only)')
  .action(() => {
    requireDarwin();

    if (!fs.existsSync(PLIST_PATH)) {
      console.error('not installed, run: myops install');
      process.exit(1);
    }

    launchctlUnload(PLIST_PATH);
    execSync(`launchctl load -w "${PLIST_PATH}"`, { stdio: 'inherit' });
    console.log('restarted:', PLIST_PATH);
  });

program.parseAsync().catch((e) => {
  console.error(e);
  process.exit(1);
});
