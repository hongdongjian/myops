import { z } from 'zod';

export const MCPAddRequestSchema = z.object({
  name: z.string(),
  transport: z.string(),
  target: z.string(),
});
export type MCPAddRequest = z.infer<typeof MCPAddRequestSchema>;

export const MCPRemoveRequestSchema = z.object({
  name: z.string(),
});
export type MCPRemoveRequest = z.infer<typeof MCPRemoveRequestSchema>;

export const MCPPresetActionRequestSchema = z.object({
  name: z.string(),
  scope: z.string().optional(),
});
export type MCPPresetActionRequest = z.infer<typeof MCPPresetActionRequestSchema>;

export interface MCPPresetInstallConfig {
  transport?: string;
  target?: string;
  headers?: string[];
  command?: string[];
  env?: Record<string, string>;
}

export interface MCPPresetDefinition {
  name: string;
  description: string;
  install: MCPPresetInstallConfig;
}

export interface MCPPresetStatus {
  name: string;
  description: string;
  installedLocal: boolean;
  installedProject: boolean;
  installedUser: boolean;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
