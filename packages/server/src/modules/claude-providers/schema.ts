import { z } from 'zod';

export const ClaudeProviderSchema = z.object({
  name: z.string().default(''),
  baseUrl: z.string().default(''),
  token: z.string().default(''),
  model: z.string().default(''),
  haikuModel: z.string().default(''),
  sonnetModel: z.string().default(''),
  opusModel: z.string().default(''),
});
export type ClaudeProvider = z.infer<typeof ClaudeProviderSchema>;

export const ProviderAddRequestSchema = ClaudeProviderSchema;
export type ProviderAddRequest = z.infer<typeof ProviderAddRequestSchema>;

export const ProviderUpdateRequestSchema = z.object({
  name: z.string(),
  newName: z.string().default(''),
  baseUrl: z.string().default(''),
  token: z.string().default(''),
  model: z.string().default(''),
  haikuModel: z.string().default(''),
  sonnetModel: z.string().default(''),
  opusModel: z.string().default(''),
});
export type ProviderUpdateRequest = z.infer<typeof ProviderUpdateRequestSchema>;

export const ProviderNameRequestSchema = z.object({
  name: z.string(),
});
export type ProviderNameRequest = z.infer<typeof ProviderNameRequestSchema>;

export interface ProvidersStore {
  activeProvider: string;
  providers: ClaudeProvider[];
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
