import fp from 'fastify-plugin';
import type { Deps } from '../../deps.js';
import { SchedulerService } from './service.js';
import {
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
  TaskIDRequestSchema,
  ExecutionsQuerySchema,
  ExecutionLogQuerySchema,
  type ApiEnvelope,
} from './schema.js';

interface SchedulerPluginOptions {
  deps: Deps;
  service?: SchedulerService;
}

export const schedulerModule = fp<SchedulerPluginOptions>(async (app, opts) => {
  const service = opts.service ?? new SchedulerService(opts.deps);
  await service.start();
  service.startTicker();

  app.get('/api/cron/tasks/list', async (): Promise<ApiEnvelope> => {
    return { success: true, data: { tasks: service.listTasks() } };
  });

  app.post('/api/cron/tasks/create', async (req): Promise<ApiEnvelope> => {
    const body = CreateTaskRequestSchema.parse(req.body);
    const task = await service.createTask({
      name: body.name.trim(),
      enabled: body.enabled,
      command: body.command,
      scheduleType: body.scheduleType,
      runAt: body.runAt || undefined,
      intervalSeconds: body.intervalSeconds,
      scheduleTime: body.scheduleTime.trim(),
      intervalDays: body.intervalDays,
      randomDelaySeconds: body.randomDelaySeconds,
      retryCount: body.retryCount,
      retryIntervalSeconds: body.retryIntervalSeconds,
    });
    return { success: true, data: task };
  });

  app.post('/api/cron/tasks/update', async (req): Promise<ApiEnvelope> => {
    const body = UpdateTaskRequestSchema.parse(req.body);
    const updated = await service.updateTask({
      id: body.id,
      name: body.name.trim(),
      enabled: body.enabled,
      command: body.command,
      scheduleType: body.scheduleType,
      runAt: body.runAt || undefined,
      intervalSeconds: body.intervalSeconds,
      scheduleTime: body.scheduleTime.trim(),
      intervalDays: body.intervalDays,
      randomDelaySeconds: body.randomDelaySeconds,
      retryCount: body.retryCount,
      retryIntervalSeconds: body.retryIntervalSeconds,
      status: '',
    });
    return { success: true, data: updated };
  });

  app.post('/api/cron/tasks/delete', async (req): Promise<ApiEnvelope> => {
    const body = TaskIDRequestSchema.parse(req.body);
    await service.deleteTask(body.id.trim());
    return { success: true };
  });

  app.post('/api/cron/tasks/enable', async (req): Promise<ApiEnvelope> => {
    const body = TaskIDRequestSchema.parse(req.body);
    await service.setEnabled(body.id.trim(), true);
    return { success: true };
  });

  app.post('/api/cron/tasks/disable', async (req): Promise<ApiEnvelope> => {
    const body = TaskIDRequestSchema.parse(req.body);
    await service.setEnabled(body.id.trim(), false);
    return { success: true };
  });

  app.post('/api/cron/tasks/run', async (req): Promise<ApiEnvelope> => {
    const body = TaskIDRequestSchema.parse(req.body);
    await service.runTaskNow(body.id.trim());
    return { success: true, message: 'task started' };
  });

  app.get('/api/cron/tasks/executions', async (req): Promise<ApiEnvelope> => {
    const { id } = ExecutionsQuerySchema.parse(req.query ?? {});
    const executions = await service.listExecutions(id.trim());
    return { success: true, data: { executions } };
  });

  app.get('/api/cron/execution/log', async (req): Promise<ApiEnvelope> => {
    const { taskId, execId } = ExecutionLogQuerySchema.parse(req.query ?? {});
    const log = await service.getExecutionLog(taskId.trim(), execId.trim());
    return { success: true, data: { log } };
  });
});
