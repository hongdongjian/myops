import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const webDist = path.join(root, 'packages/web/dist');
const serverPublic = path.join(root, 'packages/server/dist/public');

if (!fs.existsSync(webDist)) {
  console.error('web dist missing — run web build first');
  process.exit(1);
}

fs.rmSync(serverPublic, { recursive: true, force: true });
fs.cpSync(webDist, serverPublic, { recursive: true });

console.log('postbuild: web/dist → server/dist/public');
