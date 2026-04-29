import { z } from 'zod';

export const CloudreveConfigSaveRequestSchema = z.object({
  baseUrl: z.string().min(1),
  email: z.string().default(''),
  password: z.string().default(''),
});
export type CloudreveConfigSaveRequest = z.infer<typeof CloudreveConfigSaveRequestSchema>;

export const CloudreveCreateTaskRequestSchema = z.object({
  name: z.string().min(1),
  src: z.string().min(1),
  dstPath: z.string().min(1),
  policyId: z.string().default(''),
  userHashId: z.string().default(''),
  recursive: z.boolean().default(false),
  extractMediaMeta: z.boolean().default(false),
  enabled: z.boolean().default(false),
});
export type CloudreveCreateTaskRequest = z.infer<typeof CloudreveCreateTaskRequestSchema>;

export const CloudreveUpdateTaskRequestSchema = CloudreveCreateTaskRequestSchema.extend({
  id: z.string().min(1),
});
export type CloudreveUpdateTaskRequest = z.infer<typeof CloudreveUpdateTaskRequestSchema>;

export const CloudreveTaskIDRequestSchema = z.object({ id: z.string().min(1) });
export const CloudreveExecutionsQuerySchema = z.object({ id: z.string().min(1) });

export interface CloudreveConfig {
  baseUrl: string;
  email: string;
  password: string;
}

export interface CloudreveSyncTask {
  id: string;
  name: string;
  src: string;
  dstPath: string;
  policyId: string;
  userHashId: string;
  recursive: boolean;
  extractMediaMeta: boolean;
  enabled: boolean;
  status: string;
  lastRunAt?: string;
  errorMsg?: string;
}

export interface CloudreveExecution {
  id: string;
  taskId: string;
  startedAt: string;
  finishedAt?: string;
  success: boolean;
  cloudTaskId?: string;
  errorMsg?: string;
}

export interface CloudreverPolicy {
  id: string;
  name: string;
  type: string;
}

export interface CloudreverUser {
  hashId: string;
  email: string;
  nick: string;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export const MASKED_PASSWORD = '••••••••';
