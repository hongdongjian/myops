import fs from 'node:fs';
import path from 'node:path';

export interface ProcessState {
  pid: number;
  startedAt: number;
  command: string;
  args: string[];
  logPath: string;
}

function isValidState(value: unknown): value is ProcessState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.pid === 'number' &&
    typeof v.startedAt === 'number' &&
    typeof v.command === 'string' &&
    Array.isArray(v.args) &&
    v.args.every((a) => typeof a === 'string') &&
    typeof v.logPath === 'string'
  );
}

export class StateStore {
  private data: Record<string, ProcessState> = {};

  constructor(private filePath: string) {
    if (fs.existsSync(filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
        const valid: Record<string, ProcessState> = {};
        for (const [k, v] of Object.entries(parsed ?? {})) {
          if (isValidState(v)) valid[k] = v;
        }
        this.data = valid;
      } catch {
        this.data = {};
      }
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
  }

  get(key: string): ProcessState | undefined {
    const v = this.data[key];
    if (!v) return undefined;
    if (!isValidState(v)) {
      this.delete(key);
      return undefined;
    }
    return v;
  }

  set(key: string, value: ProcessState): void {
    this.data = { ...this.data, [key]: value };
    this.persist();
  }

  delete(key: string): void {
    const { [key]: _removed, ...rest } = this.data;
    this.data = rest;
    this.persist();
  }

  private persist(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}
