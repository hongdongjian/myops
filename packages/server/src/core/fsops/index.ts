import fs from 'node:fs';
import path from 'node:path';

export function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
    else fs.copyFileSync(s, d);
  }
}

export function ensureSymlink(target: string, linkPath: string): void {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    const cur = fs.readlinkSync(linkPath);
    if (cur === target) return;
    fs.unlinkSync(linkPath);
  } catch {
    if (fs.existsSync(linkPath)) fs.unlinkSync(linkPath);
  }
  fs.symlinkSync(target, linkPath);
}
