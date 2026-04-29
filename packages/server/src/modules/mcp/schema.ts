import { z } from 'zod';

export const CopyPackageRequestSchema = z.object({
  sourcePath: z.string().optional(),
});
export type CopyPackageRequest = z.infer<typeof CopyPackageRequestSchema>;

export const AutostartSetRequestSchema = z.object({
  enabled: z.boolean(),
});
export type AutostartSetRequest = z.infer<typeof AutostartSetRequestSchema>;

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
