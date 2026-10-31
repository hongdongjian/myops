import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startClashRuleRefresh, CLASH_AUTO_REFRESH_CHECK_MS } from './auto-refresh.js';
import { ClashService } from './service.js';
import { clashModule } from './routes.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const log = () => ({ info: vi.fn(), warn: vi.fn() });

describe('built-in Clash rule refresh', () => {
  it('checks immediately and every five minutes, then stops on shutdown', async () => {
    vi.useFakeTimers();
    const service = { refreshDueRules: vi.fn().mockResolvedValue({ refreshed: 0, failed: 0 }) };
    const stop = startClashRuleRefresh(service, log());
    expect(service.refreshDueRules).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CLASH_AUTO_REFRESH_CHECK_MS);
    expect(service.refreshDueRules).toHaveBeenCalledTimes(2);
    await stop();
    await vi.advanceTimersByTimeAsync(CLASH_AUTO_REFRESH_CHECK_MS);
    expect(service.refreshDueRules).toHaveBeenCalledTimes(2);
    expect(service.refreshDueRules.mock.calls[0]![0].aborted).toBe(true);
  });

  it('does not overlap checks while a refresh is running', async () => {
    vi.useFakeTimers();
    let finish!: (value: { refreshed: number; failed: number }) => void;
    const service = { refreshDueRules: vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ refreshed: 0, failed: 0 }) };
    const stop = startClashRuleRefresh(service, log());
    await vi.advanceTimersByTimeAsync(CLASH_AUTO_REFRESH_CHECK_MS * 2);
    expect(service.refreshDueRules).toHaveBeenCalledTimes(1);
    finish({ refreshed: 1, failed: 0 });
    await vi.advanceTimersByTimeAsync(CLASH_AUTO_REFRESH_CHECK_MS);
    expect(service.refreshDueRules).toHaveBeenCalledTimes(2);
    await stop();
  });

  it('cancels an in-flight automatic request when stopped', async () => {
    const service = { refreshDueRules: vi.fn((signal?: AbortSignal) => new Promise<{ refreshed: number; failed: number }>(resolve => {
      signal!.addEventListener('abort', () => resolve({ refreshed: 0, failed: 0 }), { once: true });
    })) };
    const stop = startClashRuleRefresh(service, log());
    await stop();
    expect(service.refreshDueRules.mock.calls[0]![0]!.aborted).toBe(true);
  });

  it('starts and stops with the server without creating a Cron task', async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'clash-auto-'));
    const refresh = vi.spyOn(ClashService.prototype, 'refreshDueRules').mockResolvedValue({ refreshed: 0, failed: 0 });
    const app = Fastify();
    try {
      await app.register(clashModule, { deps: { paths: createPaths(tmp) } as Deps });
      await app.ready();
      expect(refresh).toHaveBeenCalledTimes(1);
      await app.close();
      expect(refresh.mock.calls[0]![0]!.aborted).toBe(true);
      await expect(fsp.access(path.join(tmp, 'data', 'scheduler', 'tasks.json'))).rejects.toThrow();
    } finally {
      await app.close();
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});
