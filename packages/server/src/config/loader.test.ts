import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './loader.js';

describe('loadConfig', () => {
  it('parses minimal yaml', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    const file = path.join(tmp, 'server.yaml');
    fs.writeFileSync(file, 'port: 4000\nmodels:\n  - a\n  - b\n');
    const cfg = loadConfig(file);
    expect(cfg.port).toBe(4000);
    expect(cfg.models).toEqual(['a', 'b']);
  });

  it('rejects invalid port', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    const file = path.join(tmp, 'server.yaml');
    fs.writeFileSync(file, 'port: 99999\n');
    expect(() => loadConfig(file)).toThrow();
  });
});
