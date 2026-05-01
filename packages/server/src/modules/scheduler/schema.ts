import { z } from 'zod';

export const CreateTaskRequestSchema = z.object({
  name: z.string().min(1),
  command: z.string().default(''),
  enabled: z.boolean().default(false),
  scheduleType: z.enum(['once', 'interval', 'periodic']).default('periodic'),
  runAt: z.string().default(''),
  intervalSeconds: z.number().int().min(1).default(60),
  scheduleTime: z.string().default(''),
  intervalDays: z.number().int().min(1).default(1),
  randomDelaySeconds: z.number().int().min(0).default(0),
  retryCount: z.number().int().min(0).default(1),
  retryIntervalSeconds: z.number().int().min(0).default(0),
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
  command: string;
  status: string;
  scheduleType: 'once' | 'interval' | 'periodic';
  runAt?: string;
  intervalSeconds?: number;
  scheduleTime?: string;
  intervalDays?: number;
  randomDelaySeconds?: number;
  retryCount?: number;
  retryIntervalSeconds?: number;
  retryAttempts?: number;
  nextRunAt?: string;
  lastRunAt?: string;
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
