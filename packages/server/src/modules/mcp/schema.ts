import { z } from 'zod';

export const AutostartSetRequestSchema = z.object({
  enabled: z.boolean(),
});
export type AutostartSetRequest = z.infer<typeof AutostartSetRequestSchema>;

export const BinaryConfigSaveRequestSchema = z.object({
  loginBinaryPath: z.string(),
  serverBinaryPath: z.string(),
});
export type BinaryConfigSaveRequest = z.infer<typeof BinaryConfigSaveRequestSchema>;

export const LogsQuerySchema = z.object({
  lines: z.string().optional(),
});
export type LogsQuery = z.infer<typeof LogsQuerySchema>;

export interface ProcessStatus {
  name: string;
  running: boolean;
  pid: number;
  logPath: string;
  command: string;
  args: string[];
  startedAt: string;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
