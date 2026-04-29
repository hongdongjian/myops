import { z } from 'zod';

export const SettingsSaveRequestSchema = z.object({
  baseUrl: z.string().default(''),
  authToken: z.string().default(''),
  model: z.string().default(''),
  haikuModel: z.string().default(''),
});
export type SettingsSaveRequest = z.infer<typeof SettingsSaveRequestSchema>;

export const AutoCompactSetRequestSchema = z.object({
  enabled: z.boolean(),
});
export type AutoCompactSetRequest = z.infer<typeof AutoCompactSetRequestSchema>;

export const RenderModelEnvSetRequestSchema = z.object({
  enabled: z.boolean(),
});
export type RenderModelEnvSetRequest = z.infer<typeof RenderModelEnvSetRequestSchema>;

export const SettingsTemplateSaveRequestSchema = z.object({
  content: z.string(),
});
export type SettingsTemplateSaveRequest = z.infer<typeof SettingsTemplateSaveRequestSchema>;

export const PowerlineSaveRequestSchema = z.object({
  content: z.string(),
});
export type PowerlineSaveRequest = z.infer<typeof PowerlineSaveRequestSchema>;

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
