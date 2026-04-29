import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import type { CopilotAccountsService } from './service.js';
import {
  SwitchAccountRequestSchema,
  DeleteAccountRequestSchema,
  RemarkSaveRequestSchema,
  OAuthStatusQuerySchema,
} from './schema.js';
import { AppError } from '../../core/errors.js';
import { buildView } from './service.js';

interface CopilotAccountsPluginOptions {
  deps: Deps;
}

interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export const copilotAccountsModule = fp<CopilotAccountsPluginOptions>(async (app, opts) => {
  const service = opts.deps.copilotAccounts;
  if (!service) {
    throw new Error('copilotAccountsModule requires deps.copilotAccounts');
  }

  app.get('/api/copilot/accounts', async (): Promise<ApiEnvelope> => {
    const data = await service.buildAccountsPayload();
    return { success: true, data };
  });

  app.post('/api/copilot/accounts/switch', async (req): Promise<ApiEnvelope> => {
    const body = SwitchAccountRequestSchema.parse(req.body ?? {});
    const accountId = body.accountId.trim();
    if (accountId === '') {
      throw new AppError('INVALID_INPUT', 'accountId is required', 400);
    }
    const account = await service.prepareForSwitch(accountId);
    await service.writeCurrentToken(account);

    let restarted = false;
    const restartHook = (opts.deps as Deps & { copilotRestartHook?: () => Promise<boolean> })
      .copilotRestartHook;
    if (restartHook) {
      try {
        restarted = await restartHook();
      } catch (err) {
        throw new AppError(
          'COPILOT_RESTART_FAILED',
          `account switched but service restart failed: ${(err as Error).message}`,
          500,
        );
      }
    }

    const payload = await service.buildAccountsPayload();
    payload.switchedAccount = buildView(account, account.id);
    payload.restarted = restarted;
    return { success: true, message: `switched to ${account.login}`, data: payload };
  });

  app.post('/api/copilot/accounts/delete', async (req): Promise<ApiEnvelope> => {
    const body = DeleteAccountRequestSchema.parse(req.body ?? {});
    const accountId = body.accountId.trim();
    if (accountId === '') throw new AppError('INVALID_INPUT', 'accountId is required', 400);
    await service.deleteStored(accountId);
    const data = await service.buildAccountsPayload();
    return { success: true, message: 'copilot account deleted', data };
  });

  app.post('/api/copilot/accounts/remark/save', async (req): Promise<ApiEnvelope> => {
    const body = RemarkSaveRequestSchema.parse(req.body ?? {});
    const accountId = body.accountId.trim();
    if (accountId === '') throw new AppError('INVALID_INPUT', 'accountId is required', 400);
    const account = await service.saveAccountRemark(accountId, body.remark);
    const payload = await service.buildAccountsPayload();
    payload.remarkedAccount = buildView(account, payload.currentAccountId);
    return { success: true, message: 'copilot account remark saved', data: payload };
  });

  app.post('/api/copilot/accounts/oauth/start', async (): Promise<ApiEnvelope> => {
    const data = await service.startOAuth();
    return { success: true, data };
  });

  app.get('/api/copilot/accounts/oauth/status', async (req): Promise<ApiEnvelope> => {
    const q = OAuthStatusQuerySchema.parse(req.query ?? {});
    const data = service.getOAuthStatus(q.loginId.trim());
    return { success: true, data };
  });
});

export type { CopilotAccountsService };
