import fs from 'node:fs/promises';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';

export class ClaudeInstructionsService {
  constructor(private readonly deps: Deps) {}

  confPath(): string {
    return this.deps.paths.confPath('claude', 'CLAUDE.md');
  }

  homePath(): string {
    return this.deps.paths.claudePath('CLAUDE.md');
  }

  async get(): Promise<{ path: string; syncedPath: string; content: string; exists: boolean }> {
    const p = this.confPath();
    try {
      const content = await fs.readFile(p, 'utf-8');
      return { path: p, syncedPath: this.homePath(), content, exists: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { path: p, syncedPath: this.homePath(), content: '', exists: false };
      }
      throw err;
    }
  }

  async save(content: string): Promise<{ path: string; size: number }> {
    const p = this.confPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
    return { path: p, size: Buffer.byteLength(content) };
  }

  async syncStatus(): Promise<{ synced: boolean; localExists: boolean }> {
    let local: string | null = null;
    let home: string | null = null;
    try { local = await fs.readFile(this.confPath(), 'utf-8'); } catch { /* missing */ }
    try { home = await fs.readFile(this.homePath(), 'utf-8'); } catch { /* missing */ }
    return {
      synced: local !== null && home !== null && local === home,
      localExists: local !== null,
    };
  }

  async sync(): Promise<void> {
    let local: string;
    try {
      local = await fs.readFile(this.confPath(), 'utf-8');
    } catch {
      throw new AppError('INSTRUCTIONS_MISSING', '本地 CLAUDE.md 不存在，请先保存配置', 400);
    }
    const home = this.homePath();
    await fs.mkdir(path.dirname(home), { recursive: true });
    await fs.writeFile(home, local);
  }
}
