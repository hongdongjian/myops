import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateStore } from './state.js';

describe('StateStore', () => {
  it('persists and reloads state', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const file = path.join(tmp, 'state.json');
    const s1 = new StateStore(file);
    s1.set('copilot', { pid: 1234, startedAt: 100 });
    const s2 = new StateStore(file);
    expect(s2.get('copilot')).toEqual({ pid: 1234, startedAt: 100 });
  });

  it('returns undefined for missing keys', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const s = new StateStore(path.join(tmp, 'state.json'));
    expect(s.get('nope')).toBeUndefined();
  });
});
