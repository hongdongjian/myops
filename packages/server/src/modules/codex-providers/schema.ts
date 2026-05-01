import { z } from 'zod';

export const CodexProviderSchema = z.object({
  name: z.string().default(''),
  baseUrl: z.string().default(''),
  apiKey: z.string().default(''),
  model: z.string().default(''),
});
export type CodexProvider = z.infer<typeof CodexProviderSchema>;

export const ProviderAddRequestSchema = CodexProviderSchema;
export type ProviderAddRequest = z.infer<typeof ProviderAddRequestSchema>;

export const ProviderUpdateRequestSchema = z.object({
  name: z.string(),
  newName: z.string().default(''),
  baseUrl: z.string().default(''),
  apiKey: z.string().default(''),
  model: z.string().default(''),
});
export type ProviderUpdateRequest = z.infer<typeof ProviderUpdateRequestSchema>;

export const ProviderNameRequestSchema = z.object({
  name: z.string(),
});
export type ProviderNameRequest = z.infer<typeof ProviderNameRequestSchema>;

export interface ProvidersStore {
  activeProvider: string;
  providers: CodexProvider[];
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
