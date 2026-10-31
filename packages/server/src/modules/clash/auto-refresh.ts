import type { FastifyBaseLogger } from 'fastify';
import type { ClashService } from './service.js';

export const CLASH_AUTO_REFRESH_CHECK_MS = 5 * 60 * 1000;

export function startClashRuleRefresh(
  service: Pick<ClashService, 'refreshDueRules'>,
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>,
): () => Promise<void> {
  const controller = new AbortController();
  let inFlight: Promise<void> | undefined;
  const tick = () => {
    if (controller.signal.aborted || inFlight) return;
    inFlight = service.refreshDueRules(controller.signal).then(result => {
      if (!controller.signal.aborted && (result.refreshed || result.failed)) {
        log.info(result, 'Clash rules automatic refresh completed');
      }
    }).catch(err => {
      if (!controller.signal.aborted) log.warn({ err }, 'Clash rules automatic refresh failed');
    }).finally(() => { inFlight = undefined; });
  };
  tick();
  const timer = setInterval(tick, CLASH_AUTO_REFRESH_CHECK_MS);
  timer.unref?.();
  return async () => {
    clearInterval(timer);
    controller.abort();
    await inFlight;
  };
}
