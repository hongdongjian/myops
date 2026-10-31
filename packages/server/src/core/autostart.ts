import type { Deps } from '../deps.js';
import { ClaudePluginService } from '../modules/claude-plugin/service.js';

const CLAUDE_PLUGIN_TICK_MS = 10_000;

const timers: NodeJS.Timeout[] = [];

/**
 * Start background plugin auto-enable checks.
 *
 * Each tick instantiates a fresh service so it reads the current persisted
 * auto-enable settings from disk.
 */
export function startAutostartLoops(deps: Deps): void {
  const pluginTick = async () => {
    try {
      const svc = new ClaudePluginService(deps);
      await svc.autoEnableCheck();
    } catch {
      // best-effort
    }
  };

  // Check immediately before starting the periodic loop.
  void pluginTick();

  const timer = setInterval(pluginTick, CLAUDE_PLUGIN_TICK_MS);
  timer.unref?.();
  timers.push(timer);
}

export function stopAutostartLoops(): void {
  while (timers.length > 0) {
    const t = timers.pop();
    if (t) clearInterval(t);
  }
}
