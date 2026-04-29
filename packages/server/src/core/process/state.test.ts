import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateStore } from './state.js';

const sample = (over: Partial<{ pid: number; startedAt: number }> = {}) => ({
  pid: over.pid ?? 1234,
  startedAt: over.startedAt ?? 100,
  command: 'copilot-api',
  args: ['start'],
  logPath: '/tmp/copilot-api.log',
});

describe('StateStore', () => {
  it('persists and reloads state with full spawn metadata', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const file = path.join(tmp, 'state.json');
    const s1 = new StateStore(file);
    s1.set('copilot', sample());
    const s2 = new StateStore(file);
    expect(s2.get('copilot')).toEqual(sample());
  });

  it('returns undefined for missing keys', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const s = new StateStore(path.join(tmp, 'state.json'));
    expect(s.get('nope')).toBeUndefined();
  });

  it('drops legacy entries that lack the new fields', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const file = path.join(tmp, 'state.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ copilot: { pid: 99, startedAt: 1 } }));
    const s = new StateStore(file);
    expect(s.get('copilot')).toBeUndefined();
  });

  it('keeps valid entries and drops invalid ones in the same file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const file = path.join(tmp, 'state.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ legacy: { pid: 1, startedAt: 1 }, fresh: sample() }),
    );
    const s = new StateStore(file);
    expect(s.get('legacy')).toBeUndefined();
    expect(s.get('fresh')).toEqual(sample());
  });
});
