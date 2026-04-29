import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { copyDir, ensureSymlink } from './index.js';

describe('fsops', () => {
  it('copies directory recursively', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'));
    const src = path.join(tmp, 'src');
    const dst = path.join(tmp, 'dst');
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(src, 'sub', 'a.txt'), 'hello');
    copyDir(src, dst);
    expect(fs.readFileSync(path.join(dst, 'sub', 'a.txt'), 'utf-8')).toBe('hello');
  });

  it('creates symlink, replacing existing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'));
    const target = path.join(tmp, 't');
    fs.writeFileSync(target, 'x');
    const link = path.join(tmp, 'l');
    ensureSymlink(target, link);
    expect(fs.readlinkSync(link)).toBe(target);
    ensureSymlink(target, link);
    expect(fs.readlinkSync(link)).toBe(target);
  });
});
