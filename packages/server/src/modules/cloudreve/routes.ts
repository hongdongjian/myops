import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { CloudreveService } from './service.js';
import {
  CloudreveConfigSaveRequestSchema,
  CloudreveCreateTaskRequestSchema,
  CloudreveExecutionsQuerySchema,
  CloudreveTaskIDRequestSchema,
  CloudreveUpdateTaskRequestSchema,
  MASKED_PASSWORD,
  type ApiEnvelope,
  type CloudreveConfig,
} from './schema.js';

interface CloudrevePluginOptions {
  deps: Deps;
}

function trimRightSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

export const cloudreveModule = fp<CloudrevePluginOptions>(async (app, opts) => {
  const service = new CloudreveService(opts.deps);
  await service.start();

  app.get('/api/cloudreve/config', async (): Promise<ApiEnvelope> => {
    const cfg = service.getConfig();
    return {
      success: true,
      data: {
        baseUrl: cfg.baseUrl,
        email: cfg.email,
        password: cfg.password ? MASKED_PASSWORD : '',
      },
    };
  });

  app.post('/api/cloudreve/config/save', async (req): Promise<ApiEnvelope> => {
    const body = CloudreveConfigSaveRequestSchema.parse(req.body);
    const baseUrl = trimRightSlash(body.baseUrl.trim());
    const password = body.password === MASKED_PASSWORD ? service.getConfig().password : body.password;
    const cfg: CloudreveConfig = { baseUrl, email: body.email.trim(), password };
    await service.saveConfig(cfg);
    return { success: true, message: '配置已保存' };
  });

  app.post('/api/cloudreve/config/test', async (req): Promise<ApiEnvelope> => {
    const body = CloudreveConfigSaveRequestSchema.parse(req.body);
    const baseUrl = trimRightSlash(body.baseUrl.trim());
    const password = body.password === MASKED_PASSWORD ? service.getConfig().password : body.password;
    const cfg: CloudreveConfig = { baseUrl, email: body.email.trim(), password };
    const userHashId = await service.testConnection(cfg);
    return { success: true, message: '连接成功', data: { userHashId } };
  });

  app.get('/api/cloudreve/tasks/list', async (): Promise<ApiEnvelope> => {
    return { success: true, data: { tasks: service.listTasks() } };
  });

  app.post('/api/cloudreve/tasks/create', async (req): Promise<ApiEnvelope> => {
    const body = CloudreveCreateTaskRequestSchema.parse(req.body);
    const task = await service.createTask({
      name: body.name.trim(),
      src: body.src.trim(),
      dstPath: body.dstPath.trim(),
      policyId: body.policyId.trim(),
      userHashId: body.userHashId.trim(),
      recursive: body.recursive,
      extractMediaMeta: body.extractMediaMeta,
      enabled: body.enabled,
    });
    return { success: true, data: task };
  });

  app.post('/api/cloudreve/tasks/update', async (req): Promise<ApiEnvelope> => {
    const body = CloudreveUpdateTaskRequestSchema.parse(req.body);
    await service.updateTask({
      id: body.id,
      name: body.name.trim(),
      src: body.src.trim(),
      dstPath: body.dstPath.trim(),
      policyId: body.policyId.trim(),
      userHashId: body.userHashId.trim(),
      recursive: body.recursive,
      extractMediaMeta: body.extractMediaMeta,
      enabled: body.enabled,
      status: '',
    });
    return { success: true };
  });

  app.post('/api/cloudreve/tasks/delete', async (req): Promise<ApiEnvelope> => {
    const body = CloudreveTaskIDRequestSchema.parse(req.body);
    await service.deleteTask(body.id.trim());
    return { success: true };
  });

  app.post('/api/cloudreve/tasks/run', async (req): Promise<ApiEnvelope> => {
    const body = CloudreveTaskIDRequestSchema.parse(req.body);
    await service.runTask(body.id.trim());
    return { success: true, message: '同步任务已启动' };
  });

  app.get('/api/cloudreve/tasks/executions', async (req): Promise<ApiEnvelope> => {
    const { id } = CloudreveExecutionsQuerySchema.parse(req.query ?? {});
    return { success: true, data: { executions: service.listExecutions(id.trim()) } };
  });

  app.get('/api/cloudreve/policies', async (): Promise<ApiEnvelope> => {
    const policies = await service.fetchPolicies(service.getConfig());
    return { success: true, data: { policies } };
  });

  app.get('/api/cloudreve/users', async (): Promise<ApiEnvelope> => {
    const users = await service.fetchUsers(service.getConfig());
    return { success: true, data: { users } };
  });
});
