import fs from 'node:fs';
import YAML from 'yaml';
import { ConfigSchema, type Config } from './schema.js';

export function loadConfig(filePath: string): Config {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = YAML.parse(raw);
  return Object.freeze(ConfigSchema.parse(parsed ?? {}));
}
