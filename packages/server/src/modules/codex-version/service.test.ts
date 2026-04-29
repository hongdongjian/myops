import { describe, it, expect } from 'vitest';
import { parseCodexVersionOutput, buildCodexVersionStatus } from './service.js';

describe('parseCodexVersionOutput', () => {
  it('parses cli output', () => {
    expect(parseCodexVersionOutput('codex-cli 0.111.0\n')).toBe('0.111.0');
  });
  it('parses npm list output', () => {
    expect(parseCodexVersionOutput('/opt/homebrew/lib\n└── @openai/codex@0.112.0\n')).toBe('0.112.0');
  });
  it('parses plain version', () => {
    expect(parseCodexVersionOutput('0.113.1\n')).toBe('0.113.1');
  });
  it('returns empty string when nothing matches', () => {
    expect(parseCodexVersionOutput('lorem ipsum')).toBe('');
  });
});

describe('buildCodexVersionStatus', () => {
  it('uses cli current and npm view latest', () => {
    const s = buildCodexVersionStatus('codex-cli 0.111.0\n', null, '', null, '0.112.0\n', null);
    expect(s.installed).toBe(true);
    expect(s.current).toBe('0.111.0');
    expect(s.latest).toBe('0.112.0');
    expect(s.canUpgrade).toBe(true);
    expect(s.upgradeTarget).toBe('0.112.0');
    expect(s.checkError).toBeUndefined();
  });

  it('falls back to npm list output for current version', () => {
    const s = buildCodexVersionStatus(
      'command not found\n',
      'executable file not found',
      '/opt/homebrew/lib\n└── @openai/codex@0.111.0\n',
      null,
      '0.111.0\n',
      null,
    );
    expect(s.installed).toBe(true);
    expect(s.current).toBe('0.111.0');
    expect(s.canUpgrade).toBe(false);
    expect(s.checkError).toBeUndefined();
  });

  it('skips current install errors when latest is known', () => {
    const s = buildCodexVersionStatus('', 'cli missing', '', 'list failed', '0.112.0\n', null);
    expect(s.installed).toBe(false);
    expect(s.latest).toBe('0.112.0');
    expect(s.checkError).toBeUndefined();
  });

  it('reports check errors when nothing resolves', () => {
    const s = buildCodexVersionStatus('', 'cli missing', '', 'list failed', '', 'network');
    expect(s.checkError).toBeTruthy();
    expect(s.checkError).toContain('current:');
    expect(s.checkError).toContain('latest:');
    expect(s.installed).toBe(false);
  });
});
