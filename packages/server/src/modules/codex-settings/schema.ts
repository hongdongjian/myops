import { z } from 'zod';

export const CodexAuthModeSetRequestSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().optional().default(''),
  apiKey: z.string().optional().default(''),
});

export const CodexSettingsSaveRequestSchema = z.object({
  baseUrl: z.string().optional().default(''),
  apiKey: z.string().optional().default(''),
  model: z.string().optional().default(''),
});

export const CodexSettingsTemplateSaveRequestSchema = z.object({
  content: z.string(),
});

export type CodexAuthModeSetRequest = z.infer<typeof CodexAuthModeSetRequestSchema>;
export type CodexSettingsSaveRequest = z.infer<typeof CodexSettingsSaveRequestSchema>;
export type CodexSettingsTemplateSaveRequest = z.infer<typeof CodexSettingsTemplateSaveRequestSchema>;

export interface CodexConfigFields {
  modelProvider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
