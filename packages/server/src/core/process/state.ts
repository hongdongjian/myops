import fs from 'node:fs';
import path from 'node:path';

export interface ProcessState {
  pid: number;
  startedAt: number;
}

export class StateStore {
  private data: Record<string, ProcessState> = {};

  constructor(private filePath: string) {
    if (fs.existsSync(filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        this.data = {};
      }
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
  }

  get(key: string): ProcessState | undefined {
    return this.data[key];
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
