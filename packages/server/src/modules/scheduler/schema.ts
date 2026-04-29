import { z } from 'zod';

export const CreateTaskRequestSchema = z.object({
  name: z.string().min(1),
  scheduleTime: z.string().default(''),
  randomDelay: z.boolean().default(false),
  randomDelayMax: z.number().int().min(0).default(0),
  mustSucceedDaily: z.boolean().default(false),
  model: z.string().default(''),
  prompt: z.string().default(''),
  enabled: z.boolean().default(false),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const UpdateTaskRequestSchema = CreateTaskRequestSchema.extend({
  id: z.string().min(1),
});
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;

export const TaskIDRequestSchema = z.object({ id: z.string().min(1) });

export const ExecutionsQuerySchema = z.object({ id: z.string().min(1) });
export const ExecutionLogQuerySchema = z.object({
  taskId: z.string().min(1),
  execId: z.string().min(1),
});

export interface ScheduledTask {
  id: string;
  name: string;
  enabled: boolean;
  scheduleTime: string;
  randomDelay: boolean;
  randomDelayMax: number;
  mustSucceedDaily: boolean;
  model: string;
  prompt: string;
  status: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastSuccessDate?: string;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  startTime: string;
  endTime?: string;
  success: boolean;
  running: boolean;
  logFile: string;
  errorMsg?: string;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
