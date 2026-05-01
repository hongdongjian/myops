import { z } from 'zod';

export const CodexMCPPresetActionRequestSchema = z.object({
  name: z.string().min(1),
});
export type CodexMCPPresetActionRequest = z.infer<typeof CodexMCPPresetActionRequestSchema>;

export const CodexMCPPresetCreateRequestSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  installType: z.enum(['http', 'stdio']),
  url: z.string().optional(),
  headers: z.array(z.string()).optional(),
  bearerTokenEnvVar: z.string().optional(),
  command: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});
export type CodexMCPPresetCreateRequest = z.infer<typeof CodexMCPPresetCreateRequestSchema>;

export const CodexMCPPresetUpdateRequestSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  installType: z.enum(['http', 'stdio']),
  url: z.string().optional(),
  headers: z.array(z.string()).optional(),
  bearerTokenEnvVar: z.string().optional(),
  command: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});
export type CodexMCPPresetUpdateRequest = z.infer<typeof CodexMCPPresetUpdateRequestSchema>;

export const CodexMCPPresetDeleteRequestSchema = z.object({
  name: z.string(),
});
export type CodexMCPPresetDeleteRequest = z.infer<typeof CodexMCPPresetDeleteRequestSchema>;

export type CodexMCPOpAction = 'installing' | 'uninstalling';

export interface CodexMCPActiveOp {
  name: string;
  action: CodexMCPOpAction;
  startedAt: number;
}

export interface CodexMCPPresetInstallConfig {
  url?: string;
  command?: string[];
  env?: Record<string, string>;
  headers?: string[];
  bearerTokenEnvVar?: string;
}

export interface CodexMCPPresetDefinition {
  name: string;
  description: string;
  install: CodexMCPPresetInstallConfig;
}

export interface CodexMCPPresetStatus {
  name: string;
  description: string;
  install: CodexMCPPresetInstallConfig;
  installed: boolean;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: { code: string; message: string } | string;
}
