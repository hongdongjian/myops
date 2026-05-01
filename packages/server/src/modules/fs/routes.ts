import fp from 'fastify-plugin';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

interface FsEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
}

interface FsEntriesData {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export const fsModule = fp(async (app) => {
  app.get('/api/fs/entries', async (req, reply): Promise<ApiEnvelope<FsEntriesData>> => {
    const query = req.query as { path?: string };
    const rawPath = (query.path ?? '').trim();
    const dirPath = rawPath !== '' ? rawPath : os.homedir();
    const resolved = path.resolve(dirPath);

    let entries: FsEntry[] = [];
    try {
      const dirents = await fs.readdir(resolved, { withFileTypes: true });
      entries = dirents
        .map((d) => ({
          name: d.name,
          type: (d.isDirectory() ? 'directory' : 'file') as FsEntry['type'],
          path: path.join(resolved, d.name),
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch (err) {
      reply.status(400);
      return { success: false, error: (err as Error).message };
    }

    const parentPath = path.dirname(resolved);
    const parent = parentPath !== resolved ? parentPath : null;

    return { success: true, data: { path: resolved, parent, entries } };
  });
});
