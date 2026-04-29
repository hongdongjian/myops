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

  app.get('/api/scheduler/tasks/list', async (): Promise<ApiEnvelope> => {
    return { success: true, data: { tasks: service.listTasks() } };
  });

  app.post('/api/scheduler/tasks/create', async (req): Promise<ApiEnvelope> => {
    const body = CreateTaskRequestSchema.parse(req.body);
    const task = await service.createTask({
      name: body.name.trim(),
      enabled: body.enabled,
      scheduleTime: body.scheduleTime.trim(),
      randomDelay: body.randomDelay,
      randomDelayMax: body.randomDelayMax,
      mustSucceedDaily: body.mustSucceedDaily,
      model: body.model.trim(),
      prompt: body.prompt,
    });
    return { success: true, data: task };
  });

  app.post('/api/scheduler/tasks/update', async (req): Promise<ApiEnvelope> => {
    const body = UpdateTaskRequestSchema.parse(req.body);
    const updated = await service.updateTask({
      id: body.id,
      name: body.name.trim(),
      enabled: body.enabled,
      scheduleTime: body.scheduleTime.trim(),
      randomDelay: body.randomDelay,
      randomDelayMax: body.randomDelayMax,
      mustSucceedDaily: body.mustSucceedDaily,
      model: body.model.trim(),
      prompt: body.prompt,
      status: '',
    });
    return { success: true, data: updated };
  });

  app.post('/api/scheduler/tasks/delete', async (req): Promise<ApiEnvelope> => {
    const body = TaskIDRequestSchema.parse(req.body);
    await service.deleteTask(body.id.trim());
    return { success: true };
  });

  app.post('/api/scheduler/tasks/enable', async (req): Promise<ApiEnvelope> => {
    const body = TaskIDRequestSchema.parse(req.body);
    await service.setEnabled(body.id.trim(), true);
    return { success: true };
  });

  app.post('/api/scheduler/tasks/disable', async (req): Promise<ApiEnvelope> => {
    const body = TaskIDRequestSchema.parse(req.body);
    await service.setEnabled(body.id.trim(), false);
    return { success: true };
  });

  app.post('/api/scheduler/tasks/run', async (req): Promise<ApiEnvelope> => {
    const body = TaskIDRequestSchema.parse(req.body);
    await service.runTaskNow(body.id.trim());
    return { success: true, message: 'task started' };
  });

  app.get('/api/scheduler/tasks/executions', async (req): Promise<ApiEnvelope> => {
    const { id } = ExecutionsQuerySchema.parse(req.query ?? {});
    const executions = await service.listExecutions(id.trim());
    return { success: true, data: { executions } };
  });

  app.get('/api/scheduler/execution/log', async (req): Promise<ApiEnvelope> => {
    const { taskId, execId } = ExecutionLogQuerySchema.parse(req.query ?? {});
    const log = await service.getExecutionLog(taskId.trim(), execId.trim());
    return { success: true, data: { log } };
  });
});
