import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import {
  CodexImportJSONRequestSchema,
  CodexSwitchAccountRequestSchema,
  CodexDeleteAccountRequestSchema,
  CodexAccountRemarkSaveRequestSchema,
  CodexOAuthCancelRequestSchema,
  type ApiEnvelope,
} from './schema.js';
import { CodexAccountsService, buildAccountView } from './service.js';
import { AppError } from '../../core/errors.js';

interface PluginOptions {
  deps: Deps;
}

function isForceRefresh(query: unknown): boolean {
  const q = (query as Record<string, unknown> | undefined) ?? {};
  const v = String(q['refresh'] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export const codexAccountsModule = fp<PluginOptions>(async (app, opts) => {
  const service = (opts.deps.codexAccounts as CodexAccountsService | undefined)
    ?? new CodexAccountsService(opts.deps);
  // Ensure deps.codexAccounts is set so other modules (codex-settings) can call the hook.
  if (!opts.deps.codexAccounts) {
    opts.deps.codexAccounts = service;
  }

  app.get('/api/codex/accounts', async (req): Promise<ApiEnvelope> => {
    const data = await service.buildPayload(isForceRefresh(req.query));
    return { success: true, data };
  });

  app.post('/api/codex/accounts/import-local', async (): Promise<ApiEnvelope> => {
    const account = await service.importLocalAccount();
    const payload = await service.buildPayload(true);
    payload['importedAccount'] = buildAccountView(account, '');
    return { success: true, message: 'local codex account imported', data: payload };
  });

  app.post('/api/codex/accounts/import-json', async (req): Promise<ApiEnvelope> => {
    const body = CodexImportJSONRequestSchema.parse(req.body ?? {});
    const imported = await service.importFromJSONApply(body.content);
    const payload = await service.buildPayload(true);
    payload['imported'] = imported.map((a) => buildAccountView(a, ''));
    return { success: true, message: `imported ${imported.length} codex account(s)`, data: payload };
  });

  app.post('/api/codex/accounts/switch', async (req): Promise<ApiEnvelope> => {
    const body = CodexSwitchAccountRequestSchema.parse(req.body ?? {});
    const accountId = body.accountId.trim();
    if (accountId === '') throw new AppError('INVALID_INPUT', 'accountId is required', 400);
    const account = await service.prepareAccountForSwitch(accountId);
    await service.writeCurrentAuth(account);
    const payload = await service.buildPayload(true);
    payload['switchedAccount'] = buildAccountView(account, account.id);
    return { success: true, message: `switched to ${account.email}`, data: payload };
  });

  app.post('/api/codex/accounts/delete', async (req): Promise<ApiEnvelope> => {
    const body = CodexDeleteAccountRequestSchema.parse(req.body ?? {});
    const accountId = body.accountId.trim();
    if (accountId === '') throw new AppError('INVALID_INPUT', 'accountId is required', 400);
    await service.deleteAccount(accountId);
    const payload = await service.buildPayload(true);
    return { success: true, message: 'codex account deleted', data: payload };
  });

  app.post('/api/codex/accounts/remark/save', async (req): Promise<ApiEnvelope> => {
    const body = CodexAccountRemarkSaveRequestSchema.parse(req.body ?? {});
    const accountId = body.accountId.trim();
    if (accountId === '') throw new AppError('INVALID_INPUT', 'accountId is required', 400);
    const account = await service.saveAccountRemark(accountId, body.remark);
    const payload = await service.buildPayload(true);
    payload['remarkedAccount'] = buildAccountView(account, (payload['currentAccountId'] as string) ?? '');
    return { success: true, message: 'codex account remark saved', data: payload };
  });

  app.post('/api/codex/accounts/oauth/start', async (): Promise<ApiEnvelope> => {
    const r = await service.oauthStart();
    return { success: true, data: r };
  });

  app.get('/api/codex/accounts/oauth/status', async (req): Promise<ApiEnvelope> => {
    const q = (req.query as Record<string, unknown> | undefined) ?? {};
    const loginId = String(q['loginId'] ?? '').trim();
    if (loginId === '') throw new AppError('INVALID_INPUT', 'loginId is required', 400);
    const r = service.oauthStatus(loginId);
    return { success: true, data: r };
  });

  app.post('/api/codex/accounts/oauth/cancel', async (req): Promise<ApiEnvelope> => {
    const body = CodexOAuthCancelRequestSchema.parse(req.body ?? {});
    service.oauthCancel(body.loginId);
    return { success: true, message: 'codex oauth login cancelled' };
  });
});
