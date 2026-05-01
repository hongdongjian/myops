import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const distDir = path.join(root, 'packages/server/dist');

// clean dist, preserve public/
if (fs.existsSync(distDir)) {
  for (const entry of fs.readdirSync(distDir)) {
    if (entry === 'public') continue;
    fs.rmSync(path.join(distDir, entry), { recursive: true, force: true });
  }
}
fs.mkdirSync(distDir, { recursive: true });

build({
  entryPoints: [path.join(root, 'packages/server/src/cli.ts')],
  bundle: true,
  minify: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(distDir, 'cli.js'),
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
}).then(() => {
  console.log('bundle: packages/server/dist/cli.js');
}).catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
