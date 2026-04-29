import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { ImmichSyncService } from './service.js';
import {
  ImmichAccountIDRequestSchema,
  ImmichAddAccountRequestSchema,
  ImmichCreateAlbumRequestSchema,
  ImmichCreatePlanRequestSchema,
  ImmichPlanIDRequestSchema,
  ImmichUpdatePlanRequestSchema,
  type ApiEnvelope,
  DEFAULT_IMMICH_BASE_URL,
} from './schema.js';
import { AppError } from '../../core/errors.js';

interface ImmichSyncPluginOptions {
  deps: Deps;
}

export const immichSyncModule = fp<ImmichSyncPluginOptions>(async (app, opts) => {
  const service = new ImmichSyncService(opts.deps);
  await service.start();
  service.startTicker();
  app.addHook('onClose', async () => service.stopTicker());

  // ── accounts ───────────────────────────────────────────────────────────
  app.get('/api/immich/accounts', async (): Promise<ApiEnvelope> => {
    return {
      success: true,
      data: { accounts: service.listAccounts(), activeId: service.getActiveAccountId() },
    };
  });

  app.post('/api/immich/accounts/add', async (req): Promise<ApiEnvelope> => {
    const body = ImmichAddAccountRequestSchema.parse(req.body);
    const apiKey = body.apiKey.trim();
    if (!apiKey) throw new AppError('VALIDATION', 'apiKey is required', 400);
    const baseUrl = body.baseUrl.trim() || DEFAULT_IMMICH_BASE_URL;
    let user;
    try {
      user = await service.getCurrentUser({ baseUrl, apiKey });
    } catch (err) {
      throw new AppError('IMMICH_AUTH', `API 密钥验证失败: ${(err as Error).message}`, 400);
    }
    const account = await service.addAccount({
      name: body.name.trim() || user.name || user.email,
      email: user.email,
      apiKey,
      baseUrl,
    });
    return { success: true, data: account };
  });

  app.post('/api/immich/accounts/delete', async (req): Promise<ApiEnvelope> => {
    const body = ImmichAccountIDRequestSchema.parse(req.body);
    await service.deleteAccount(body.id.trim());
    return { success: true };
  });

  app.post('/api/immich/accounts/switch', async (req): Promise<ApiEnvelope> => {
    const body = ImmichAccountIDRequestSchema.parse(req.body);
    await service.setActiveAccount(body.id.trim());
    return { success: true };
  });

  app.get('/api/immich/me', async (): Promise<ApiEnvelope> => {
    const user = await service.getCurrentUser(service.getConfig());
    return { success: true, data: user };
  });

  // ── people / albums ────────────────────────────────────────────────────
  app.get('/api/immich/people', async (): Promise<ApiEnvelope> => {
    const people = await service.listPeople(service.getConfig());
    return { success: true, data: { people } };
  });

  app.get('/api/immich/albums', async (): Promise<ApiEnvelope> => {
    const albums = await service.listAlbums(service.getConfig());
    return { success: true, data: { albums } };
  });

  app.post('/api/immich/albums/create', async (req): Promise<ApiEnvelope> => {
    const body = ImmichCreateAlbumRequestSchema.parse(req.body);
    const album = await service.createAlbum(service.getConfig(), body.name.trim());
    return { success: true, data: album };
  });

  // ── sync plans ─────────────────────────────────────────────────────────
  app.get('/api/immich/sync/plans', async (): Promise<ApiEnvelope> => {
    return { success: true, data: { plans: service.listPlans() } };
  });

  app.post('/api/immich/sync/plans/create', async (req): Promise<ApiEnvelope> => {
    const body = ImmichCreatePlanRequestSchema.parse(req.body);
    const plan = await service.createPlan({
      accountId: body.accountId.trim(),
      name: body.name.trim(),
      personIds: body.personIds,
      personNames: body.personNames,
      albumId: body.albumId.trim(),
      albumName: body.albumName,
      removeDeleted: body.removeDeleted,
      enabled: body.enabled,
      scheduleInterval: body.scheduleInterval,
    });
    return { success: true, data: plan };
  });

  app.post('/api/immich/sync/plans/update', async (req): Promise<ApiEnvelope> => {
    const body = ImmichUpdatePlanRequestSchema.parse(req.body);
    await service.updatePlan(body.id.trim(), {
      accountId: body.accountId.trim(),
      name: body.name.trim(),
      personIds: body.personIds,
      personNames: body.personNames,
      albumId: body.albumId.trim(),
      albumName: body.albumName,
      removeDeleted: body.removeDeleted,
      enabled: body.enabled,
      scheduleInterval: body.scheduleInterval,
    });
    return { success: true };
  });

  app.post('/api/immich/sync/plans/delete', async (req): Promise<ApiEnvelope> => {
    const body = ImmichPlanIDRequestSchema.parse(req.body);
    await service.deletePlan(body.id.trim());
    return { success: true };
  });

  app.post('/api/immich/sync/plans/enable', async (req): Promise<ApiEnvelope> => {
    const body = ImmichPlanIDRequestSchema.parse(req.body);
    await service.setPlanEnabled(body.id.trim(), true);
    return { success: true };
  });

  app.post('/api/immich/sync/plans/disable', async (req): Promise<ApiEnvelope> => {
    const body = ImmichPlanIDRequestSchema.parse(req.body);
    await service.setPlanEnabled(body.id.trim(), false);
    return { success: true };
  });

  app.post('/api/immich/sync/plans/run', async (req): Promise<ApiEnvelope> => {
    const body = ImmichPlanIDRequestSchema.parse(req.body);
    service.triggerRun(body.id.trim());
    return { success: true, message: 'sync started' };
  });

  app.get('/api/immich/sync/progress', async (): Promise<ApiEnvelope> => {
    return { success: true, data: { progress: service.allProgress() } };
  });
});
