import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export interface Paths {
  rootDir: string;
  homeDir: string;
  dataPath: (...p: string[]) => string;
  confPath: (...p: string[]) => string;
  claudePath: (...p: string[]) => string;
  codexPath: (...p: string[]) => string;
}

export function createPaths(rootDir: string): Paths {
  const homeDir = os.homedir();
  fs.mkdirSync(path.join(rootDir, 'data'), { recursive: true });
  return {
    rootDir,
    homeDir,
    dataPath: (...p) => path.join(rootDir, 'data', ...p),
    confPath: (...p) => path.join(rootDir, 'conf', ...p),
    claudePath: (...p) => path.join(homeDir, '.claude', ...p),
    codexPath: (...p) => path.join(homeDir, '.codex', ...p),
  };
}
