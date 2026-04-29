import { describe, it, expect } from 'vitest';
import {
  buildVersionStatus,
  parseCurrentVersionOutput,
  parseLatestVersionOutput,
  ClaudeVersionService,
  clearClaudeVersionCache,
} from './service.js';
import type { Deps } from '../../deps.js';

function makeDeps(): Deps {
  return {
    config: { port: 0, models: [] } as any,
    paths: {} as any,
    runner: {} as any,
    store: {} as any,
    processMgr: {} as any,
  };
}

describe('parseCurrentVersionOutput', () => {
  it('parses claude --version output', () => {
    expect(parseCurrentVersionOutput('2.1.63 (Claude Code)\n')).toBe('2.1.63');
  });
  it('parses plain version', () => {
    expect(parseCurrentVersionOutput('2.1.66\n')).toBe('2.1.66');
  });
});

describe('parseLatestVersionOutput', () => {
  it('parses dist-tags latest', () => {
    const input = [
      '@anthropic-ai/claude-code@2.1.70 | SEE LICENSE IN README.md | deps: none | versions: 346',
      'dist-tags:',
      'latest: 2.1.70',
      'next: 2.1.70',
    ].join('\n');
    expect(parseLatestVersionOutput(input)).toBe('2.1.70');
  });
});

describe('buildVersionStatus', () => {
  it('reports canUpgrade when current and latest differ', () => {
    const s = buildVersionStatus(
      '2.1.63 (Claude Code)\n',
      null,
      '@anthropic-ai/claude-code@2.1.70\ndist-tags:\nlatest: 2.1.70\n',
      null,
    );
    expect(s.installed).toBe(true);
    expect(s.current).toBe('2.1.63');
    expect(s.latest).toBe('2.1.70');
    expect(s.canUpgrade).toBe(true);
    expect(s.upgradeTarget).toBe('2.1.70');
    expect(s.checkError).toBeUndefined();
  });
  it('skips current error when latest is known', () => {
    const s = buildVersionStatus(
      '',
      'command not found',
      '@anthropic-ai/claude-code@2.1.70\ndist-tags:\nlatest: 2.1.70\n',
      null,
    );
    expect(s.installed).toBe(false);
    expect(s.current).toBe('');
    expect(s.latest).toBe('2.1.70');
    expect(s.checkError).toBeUndefined();
  });
  it('reports check errors when both lookups fail', () => {
    const s = buildVersionStatus('', 'command not found', '', 'npm view failed');
    expect(s.checkError).toContain('current:');
    expect(s.checkError).toContain('latest:');
  });
});

describe('ClaudeVersionService operation state', () => {
  it('begin and finish track operation', () => {
    clearClaudeVersionCache();
    const svc = new ClaudeVersionService(makeDeps());
    expect(svc.currentOperation()).toBeNull();
    expect(svc.begin('upgrade')).toBe(true);
    const op = svc.currentOperation();
    expect(op?.running).toBe(true);
    expect(op?.action).toBe('upgrade');
    expect(svc.begin('upgrade')).toBe(false);
    svc.finish();
    expect(svc.currentOperation()).toBeNull();
  });
});
