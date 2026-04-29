import { z } from 'zod';

export const CodexMCPPresetActionRequestSchema = z.object({
  name: z.string().min(1),
});

export type CodexMCPPresetActionRequest = z.infer<typeof CodexMCPPresetActionRequestSchema>;

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
  installed: boolean;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: { code: string; message: string } | string;
}
