import { z } from 'zod';

export const ConfigSaveRequestSchema = z.object({
  content: z.string(),
});
export type ConfigSaveRequest = z.infer<typeof ConfigSaveRequestSchema>;

export const AutostartSetRequestSchema = z.object({
  enabled: z.boolean(),
});
export type AutostartSetRequest = z.infer<typeof AutostartSetRequestSchema>;

export const ProxySetRequestSchema = z.object({
  enabled: z.boolean(),
});
export type ProxySetRequest = z.infer<typeof ProxySetRequestSchema>;

export const PortSetRequestSchema = z.object({
  port: z.number().int().positive(),
});
export type PortSetRequest = z.infer<typeof PortSetRequestSchema>;

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

export interface VersionStatus {
  installed: boolean;
  current: string;
  latest: string;
  canUpgrade: boolean;
  upgradeTarget: string;
  checkError?: string;
}

export interface UsageStatus {
  quotaId: string;
  used: number;
  total: number;
  remaining: number;
  percentUsed: number;
  unlimited: boolean;
  resetDate: string;
}

export interface UsageQuotaSnapshot {
  quota_id: string;
  entitlement: number;
  remaining: number;
  percent_remaining: number;
  unlimited: boolean;
}

export interface UsageResponse {
  quota_reset_date: string;
  quota_snapshots: Record<string, UsageQuotaSnapshot>;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
