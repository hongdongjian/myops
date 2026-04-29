import type { Deps } from '../deps.js';
import { CopilotService } from '../modules/copilot/service.js';
import { XHSService } from '../modules/mcp/service.js';
import { ClaudePluginService } from '../modules/claude-plugin/service.js';

const COPILOT_TICK_MS = 30_000;
const XHS_TICK_MS = 30_000;
const CLAUDE_PLUGIN_TICK_MS = 10_000;

const timers: NodeJS.Timeout[] = [];

/**
 * Start background autostart loops.
 *
 * Each loop instantiates a fresh service per tick so it reads the current
 * persisted autostart/auto-enable settings from disk. Process state is shared
 * via deps.processMgr.
 */
export function startAutostartLoops(deps: Deps): void {
  const copilotTick = async () => {
    try {
      const svc = new CopilotService(deps);
      await svc.autostartCheck();
    } catch {
      // best-effort; never let a tick crash the process
    }
  };

  const xhsTick = async () => {
    try {
      const svc = new XHSService(deps);
      await svc.autostartCheck();
    } catch {
      // best-effort
    }
  };

  const pluginTick = async () => {
    try {
      const svc = new ClaudePluginService(deps);
      await svc.autoEnableCheck();
    } catch {
      // best-effort
    }
  };

  // Immediate initial check (fire-and-forget) to mirror Go behaviour.
  void copilotTick();
  void xhsTick();
  void pluginTick();

  const t1 = setInterval(copilotTick, COPILOT_TICK_MS);
  const t2 = setInterval(xhsTick, XHS_TICK_MS);
  const t3 = setInterval(pluginTick, CLAUDE_PLUGIN_TICK_MS);

  for (const t of [t1, t2, t3]) {
    t.unref?.();
    timers.push(t);
  }
}

export function stopAutostartLoops(): void {
  while (timers.length > 0) {
    const t = timers.pop();
    if (t) clearInterval(t);
  }
}
