import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const home = os.homedir();
const installDir = path.join(home, '.myops');
const plistPath = path.join(home, 'Library/LaunchAgents/com.hongdongjian.myops.plist');
const nodeBin = process.execPath;

if (process.argv.includes('--help')) {
  console.log('usage: tsx scripts/deploy-launchd.ts');
  console.log('  installs myops to ~/.myops and registers a launchd agent');
  process.exit(0);
}

fs.mkdirSync(installDir, { recursive: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const tgz =
  findLatestTarball(path.join(repoRoot, 'dist-pack')) ??
  findLatestTarball(path.join(repoRoot, 'packages/server'));
if (tgz) {
  execSync(`npm i --prefix ${installDir} ${tgz}`, { stdio: 'inherit' });
} else {
  execSync(`npm i --prefix ${installDir} myops@latest`, { stdio: 'inherit' });
}

const cliPath = path.join(installDir, 'node_modules/myops/dist/cli.js');
if (!fs.existsSync(cliPath)) {
  console.error(`cli not found at ${cliPath}`);
  process.exit(1);
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.hongdongjian.myops</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${cliPath}</string>
  </array>
  <key>WorkingDirectory</key><string>${installDir}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${installDir}/data/launchd.out.log</string>
  <key>StandardErrorPath</key><string>${installDir}/data/launchd.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'}</string>
    ${process.env.GITHUB_API_TOKEN ? `<key>GITHUB_API_TOKEN</key><string>${process.env.GITHUB_API_TOKEN}</string>` : ''}
  </dict>
</dict>
</plist>`;
fs.writeFileSync(plistPath, plist);

try {
  execSync(`launchctl unload ${plistPath}`, { stdio: 'ignore' });
} catch {
  // ignore — agent may not be loaded
}
execSync(`launchctl load -w ${plistPath}`, { stdio: 'inherit' });
console.log('deployed:', plistPath);
console.log('logs:', path.join(installDir, 'data'));

function findLatestTarball(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('myops-') && f.endsWith('.tgz'));
  if (files.length === 0) return null;
  files.sort();
  return path.join(dir, files[files.length - 1]!);
}
