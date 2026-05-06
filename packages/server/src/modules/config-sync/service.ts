import fsp from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Runner } from '../../core/system/runner.js';
import type { Paths } from '../../paths.js';
import { AppError } from '../../core/errors.js';

// Matches GitHub HTTPS (with or without .git) and SSH URLs
const GITHUB_URL_RE =
  /^(https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+(\.git)?|git@github\.com:[\w.\-]+\/[\w.\-]+(\.git)?)$/;

const CONFIG_SYNC_FILE = 'config-sync.json';

interface ConfigSyncData {
  githubUrl: string;
}

export type ProgressFn = (msg: string) => void;

export class ConfigSyncService {
  constructor(
    private readonly paths: Paths,
    private readonly runner: Runner,
  ) {}

  confDir(): string {
    return this.paths.confPath();
  }

  async init(githubUrl: string, progress: ProgressFn = () => {}): Promise<void> {
    if (!GITHUB_URL_RE.test(githubUrl)) {
      throw new AppError('INVALID_URL', `invalid GitHub URL: ${githubUrl}`, 400);
    }

    // Fail if already configured
    const confDir = this.confDir();
    await fsp.mkdir(confDir, { recursive: true });
    if (await this.isGitRepo(confDir)) {
      const remote = await this.runner.run('git', ['remote'], { cwd: confDir });
      const remoteList = remote.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      if (remoteList.includes('origin')) {
        const urlResult = await this.runner.run(
          'git',
          ['remote', 'get-url', 'origin'],
          { cwd: confDir },
        );
        throw new AppError(
          'ALREADY_CONFIGURED',
          `conf directory is already configured with remote: ${urlResult.stdout.trim()}`,
          400,
        );
      }
    }

    progress('checking remote repository...');
    await this.checkRemoteEmpty(githubUrl);

    const isRepo = await this.isGitRepo(confDir);
    if (!isRepo) {
      progress('initializing git repository...');
      const init = await this.runner.run('git', ['init'], { cwd: confDir });
      if (init.code !== 0) {
        throw new AppError('GIT_INIT_FAILED', `git init failed: ${init.stderr}`, 500);
      }
    }

    await ensureGitignore(confDir);

    await this.runner.run('git', ['add', '-A'], { cwd: confDir });
    const statusResult = await this.runner.run('git', ['status', '--porcelain'], { cwd: confDir });
    if (statusResult.stdout.trim()) {
      progress('committing...');
      const commit = await this.runner.run(
        'git',
        ['commit', '-m', 'init: sync conf to github'],
        { cwd: confDir },
      );
      if (commit.code !== 0) {
        throw new AppError('COMMIT_FAILED', `commit failed: ${commit.stderr}`, 500);
      }
    }

    const addRemote = await this.runner.run(
      'git',
      ['remote', 'add', 'origin', githubUrl],
      { cwd: confDir },
    );
    if (addRemote.code !== 0) {
      throw new AppError('REMOTE_ADD_FAILED', `failed to add remote: ${addRemote.stderr}`, 500);
    }

    // Skip push if there are no commits
    const logResult = await this.runner.run('git', ['log', '--oneline', '-1'], { cwd: confDir });
    if (!logResult.stdout.trim()) {
      await this.saveUrl(githubUrl);
      return;
    }

    const branchResult = await this.runner.run(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: confDir },
    );
    const branch = branchResult.stdout.trim() || 'main';

    progress('pushing to remote...');
    const push = await this.runner.run('git', ['push', '-u', 'origin', branch], { cwd: confDir });
    if (push.code !== 0) {
      throw new AppError(
        'PUSH_FAILED',
        `push failed: ${push.stderr.trim() || push.stdout.trim()}`,
        500,
      );
    }

    await this.saveUrl(githubUrl);
  }

  async pull(githubUrl: string, force: boolean, progress: ProgressFn = () => {}): Promise<void> {
    if (!GITHUB_URL_RE.test(githubUrl)) {
      throw new AppError('INVALID_URL', `invalid GitHub URL: ${githubUrl}`, 400);
    }

    const confDir = this.confDir();
    const hasContent = await this.confDirHasContent(confDir);
    if (hasContent && !force) {
      throw new AppError(
        'CONF_EXISTS',
        `conf directory already exists with content. Run with --force-pull to delete and re-clone`,
        400,
      );
    }

    if (force && hasContent) {
      progress('removing existing conf directory...');
      await fsp.rm(confDir, { recursive: true, force: true });
    }

    progress('cloning repository...');
    const clone = await this.runner.run('git', ['clone', githubUrl, confDir]);
    if (clone.code !== 0) {
      throw new AppError(
        'CLONE_FAILED',
        `clone failed: ${clone.stderr.trim() || clone.stdout.trim()}`,
        500,
      );
    }

    await this.saveUrl(githubUrl);
  }

  async upload(force: boolean, progress: ProgressFn = () => {}): Promise<void> {
    const confDir = this.confDir();
    await this.ensureConfigured(confDir);

    await ensureGitignore(confDir);
    await this.runner.run('git', ['add', '-A'], { cwd: confDir });

    const statusResult = await this.runner.run('git', ['status', '--porcelain'], { cwd: confDir });
    if (statusResult.stdout.trim()) {
      progress('committing local changes...');
      const commit = await this.runner.run(
        'git',
        ['commit', '-m', 'sync: upload conf'],
        { cwd: confDir },
      );
      if (commit.code !== 0) {
        throw new AppError('COMMIT_FAILED', `commit failed: ${commit.stderr.trim()}`, 500);
      }
    }

    progress('pushing to remote...');
    const pushArgs = ['push', 'origin', 'HEAD'];
    if (force) pushArgs.push('--force');

    const push = await this.runner.run('git', pushArgs, { cwd: confDir });
    if (push.code !== 0) {
      const errMsg = push.stderr.trim() || push.stdout.trim();
      if (
        !force &&
        (errMsg.includes('rejected') ||
          errMsg.includes('[rejected]') ||
          errMsg.includes('non-fast-forward'))
      ) {
        throw new AppError(
          'PUSH_CONFLICT',
          `push rejected (remote has newer commits):\n${errMsg}\nRun with --force to overwrite remote`,
          409,
        );
      }
      throw new AppError('PUSH_FAILED', `push failed: ${errMsg}`, 500);
    }
  }

  async update(force: boolean, progress: ProgressFn = () => {}): Promise<void> {
    const confDir = this.confDir();
    await this.ensureConfigured(confDir);

    if (!force) {
      const statusResult = await this.runner.run(
        'git',
        ['status', '--porcelain'],
        { cwd: confDir },
      );
      if (statusResult.stdout.trim()) {
        throw new AppError(
          'LOCAL_CHANGES',
          `local changes detected:\n${statusResult.stdout.trim()}\nRun with --force to discard local changes`,
          400,
        );
      }
    } else {
      progress('discarding local changes...');
      await this.runner.run('git', ['reset', '--hard', 'HEAD'], { cwd: confDir });
      await this.runner.run('git', ['clean', '-fd'], { cwd: confDir });
    }

    progress('pulling from remote...');
    const pull = await this.runner.run('git', ['pull', 'origin'], { cwd: confDir });
    if (pull.code !== 0) {
      throw new AppError(
        'PULL_FAILED',
        `pull failed: ${pull.stderr.trim() || pull.stdout.trim()}`,
        500,
      );
    }
  }

  async status(): Promise<{
    confDir: string;
    remoteUrl: string | null;
    branch: string | null;
    changes: string[];
    ahead: string[];
    behind: string[];
  }> {
    const confDir = this.confDir();
    const isRepo = await this.isGitRepo(confDir);
    if (!isRepo) {
      return { confDir, remoteUrl: null, branch: null, changes: [], ahead: [], behind: [] };
    }
    const remoteResult = await this.runner.run('git', ['remote', 'get-url', 'origin'], { cwd: confDir });
    const remoteUrl = remoteResult.code === 0 ? remoteResult.stdout.trim() : null;
    const branchResult = await this.runner.run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: confDir });
    const branch = branchResult.code === 0 ? branchResult.stdout.trim() : null;
    const statusResult = await this.runner.run('git', ['status', '--porcelain'], { cwd: confDir });
    const changes = statusResult.stdout.split('\n').filter(Boolean);

    let ahead: string[] = [];
    let behind: string[] = [];
    if (branch) {
      await this.runner.run('git', ['fetch', 'origin'], { cwd: confDir });
      const aheadResult = await this.runner.run(
        'git', ['log', `origin/${branch}..HEAD`, '--oneline'], { cwd: confDir },
      );
      if (aheadResult.code === 0) ahead = aheadResult.stdout.split('\n').filter(Boolean);
      const behindResult = await this.runner.run(
        'git', ['log', `HEAD..origin/${branch}`, '--oneline'], { cwd: confDir },
      );
      if (behindResult.code === 0) behind = behindResult.stdout.split('\n').filter(Boolean);
    }

    return { confDir, remoteUrl, branch, changes, ahead, behind };
  }

  loadSavedUrl(): string | null {
    try {
      const raw = fsSync.readFileSync(this.paths.dataPath(CONFIG_SYNC_FILE), 'utf-8');
      const data = JSON.parse(raw) as ConfigSyncData;
      return data.githubUrl || null;
    } catch {
      return null;
    }
  }

  private async saveUrl(githubUrl: string): Promise<void> {
    const filePath = this.paths.dataPath(CONFIG_SYNC_FILE);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify({ githubUrl }, null, 2));
  }

  private async checkRemoteEmpty(githubUrl: string): Promise<void> {
    const ls = await this.runner.run('git', ['ls-remote', '--heads', githubUrl]);
    if (ls.code !== 0) {
      throw new AppError(
        'INVALID_REPO',
        `cannot access repository: ${ls.stderr.trim() || 'invalid URL or permission denied'}`,
        400,
      );
    }
    if (!ls.stdout.trim()) return;

    // Use blobless clone to avoid downloading file contents
    const tmpDir = path.join(os.tmpdir(), `myops-check-${Date.now()}`);
    try {
      const clone = await this.runner.run('git', [
        'clone',
        '--depth=1',
        '--filter=blob:none',
        '--no-checkout',
        githubUrl,
        tmpDir,
      ]);
      if (clone.code !== 0) {
        throw new AppError(
          'CLONE_FAILED',
          `cannot access repository: ${clone.stderr.trim()}`,
          400,
        );
      }
      const tree = await this.runner.run('git', ['ls-tree', '--name-only', 'HEAD'], { cwd: tmpDir });
      const files = tree.stdout.split('\n').map((f) => f.trim()).filter(Boolean);
      const nonReadme = files.filter((f) => f.toLowerCase() !== 'readme.md');
      if (nonReadme.length > 0) {
        throw new AppError(
          'REPO_NOT_EMPTY',
          `repository already contains files: ${nonReadme.join(', ')}`,
          400,
        );
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  }

  private async isGitRepo(dir: string): Promise<boolean> {
    try {
      await fsp.stat(path.join(dir, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  private async confDirHasContent(dir: string): Promise<boolean> {
    try {
      const entries = await fsp.readdir(dir);
      return entries.some((e) => !e.startsWith('.'));
    } catch {
      return false;
    }
  }

  private async ensureConfigured(dir: string): Promise<void> {
    if (!(await this.isGitRepo(dir))) {
      throw new AppError(
        'NOT_CONFIGURED',
        `conf directory is not a git repository. Run 'myops config init <github-url>' first`,
        400,
      );
    }
    const remote = await this.runner.run('git', ['remote'], { cwd: dir });
    const remoteList = remote.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!remoteList.includes('origin')) {
      throw new AppError(
        'NO_REMOTE',
        `no remote configured. Run 'myops config init <github-url>' first`,
        400,
      );
    }
  }
}

// Ensure .gitignore exists and includes .DS_Store
async function ensureGitignore(dir: string): Promise<void> {
  const gitignorePath = path.join(dir, '.gitignore');
  let content = '';
  try {
    content = await fsp.readFile(gitignorePath, 'utf-8');
  } catch {
    // file doesn't exist, will create
  }
  const lines = content.split('\n').map((l) => l.trim());
  if (!lines.includes('.DS_Store')) {
    const updated = content.endsWith('\n') || content === ''
      ? content + '.DS_Store\n'
      : content + '\n.DS_Store\n';
    await fsp.writeFile(gitignorePath, updated, 'utf-8');
  }
}
