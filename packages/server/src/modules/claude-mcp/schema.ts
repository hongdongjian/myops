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

export const MCPPresetCreateRequestSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  installType: z.enum(['http', 'sse', 'stdio']),
  target: z.string().optional(),
  headers: z.array(z.string()).optional(),
  command: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});
export type MCPPresetCreateRequest = z.infer<typeof MCPPresetCreateRequestSchema>;

export const MCPPresetDeleteRequestSchema = z.object({
  name: z.string(),
});
export type MCPPresetDeleteRequest = z.infer<typeof MCPPresetDeleteRequestSchema>;

export const MCPPresetUpdateRequestSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  installType: z.enum(['http', 'sse', 'stdio']),
  target: z.string().optional(),
  headers: z.array(z.string()).optional(),
  command: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});
export type MCPPresetUpdateRequest = z.infer<typeof MCPPresetUpdateRequestSchema>;

export type MCPOpAction = 'installing' | 'uninstalling';

export interface MCPActiveOp {
  name: string;
  action: MCPOpAction;
  startedAt: number;
}

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
  install: MCPPresetInstallConfig;
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
