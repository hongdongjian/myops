import { describe, it, expect } from 'vitest';
import { Runner } from './runner.js';

describe('Runner', () => {
  const runner = new Runner();

  it('runs sync command and returns stdout', async () => {
    const r = await runner.run('echo', ['hello']);
    expect(r.stdout.trim()).toBe('hello');
    expect(r.code).toBe(0);
  });

  it('captures non-zero exit', async () => {
    const r = await runner.run('sh', ['-c', 'exit 3']);
    expect(r.code).toBe(3);
  });

  it('strips CLAUDECODE from env when option set', async () => {
    process.env.CLAUDECODE = '1';
    const r = await runner.run('sh', ['-c', 'echo $CLAUDECODE'], { stripClaudeCode: true });
    expect(r.stdout.trim()).toBe('');
    delete process.env.CLAUDECODE;
  });
});
