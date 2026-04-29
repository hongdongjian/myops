import { describe, it, expect } from 'vitest';
import {
  parseCodexMCPHeaders,
  buildPresetInstallArgs,
  isAlreadyExists,
  isNotFound,
} from './service.js';

describe('codex mcp service helpers', () => {
  it('parses headers correctly', () => {
    const out = parseCodexMCPHeaders(['Authorization: Bearer x', 'X-Trace: 1', '']);
    expect(out).toEqual({ Authorization: 'Bearer x', 'X-Trace': '1' });
  });

  it('rejects malformed headers', () => {
    expect(() => parseCodexMCPHeaders(['no-colon'])).toThrow();
    expect(() => parseCodexMCPHeaders([': empty'])).toThrow();
  });

  it('builds args for url preset', () => {
    const args = buildPresetInstallArgs({
      name: 'foo',
      description: '',
      install: { url: 'https://x.example/mcp', bearerTokenEnvVar: 'TOK' },
    });
    expect(args).toEqual(['mcp', 'add', 'foo', '--url', 'https://x.example/mcp', '--bearer-token-env-var', 'TOK']);
  });

  it('builds args for command preset', () => {
    const args = buildPresetInstallArgs({
      name: 'cmd',
      description: '',
      install: { command: ['node', 'server.js'], env: { B: '2', A: '1' } },
    });
    expect(args).toEqual(['mcp', 'add', 'cmd', '--env', 'A=1', '--env', 'B=2', '--', 'node', 'server.js']);
  });

  it('errors when neither url nor command provided', () => {
    expect(() => buildPresetInstallArgs({ name: 'x', description: '', install: {} })).toThrow();
  });

  it('detects already-exists and not-found markers', () => {
    expect(isAlreadyExists('mcp foo already exists', '')).toBe(true);
    expect(isAlreadyExists('', 'ok')).toBe(false);
    expect(isNotFound('', 'mcp not found')).toBe(true);
    expect(isNotFound('ok', '')).toBe(false);
  });
});
