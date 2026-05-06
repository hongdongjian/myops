import { z } from 'zod';

export const PluginActionRequestSchema = z.object({
  package: z.string(),
});
export type PluginActionRequest = z.infer<typeof PluginActionRequestSchema>;

export const AddPresetRequestSchema = z.object({
  name: z.string().min(1),
  package: z.string().min(1),
  description: z.string().optional(),
  source: z.string().optional(),
  link: z.string().optional(),
});
export type AddPresetRequest = z.infer<typeof AddPresetRequestSchema>;

export const UpdatePresetRequestSchema = z.object({
  package: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  source: z.string().optional(),
  link: z.string().optional(),
});
export type UpdatePresetRequest = z.infer<typeof UpdatePresetRequestSchema>;

export const RemovePresetRequestSchema = z.object({
  package: z.string().min(1),
});
export type RemovePresetRequest = z.infer<typeof RemovePresetRequestSchema>;

export interface PluginPresetDefinition {
  name: string;
  description?: string;
  package: string;
  source?: string;
  scope: string;
  link?: string;
}

export interface InstalledPlugin {
  id: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
  installedAt: string;
  lastUpdated: string;
}

export interface PluginMarketplace {
  name: string;
  source?: string;
  repo?: string;
  url?: string;
  installLocation?: string;
}

export type PluginOpAction = 'installing' | 'enabling' | 'disabling' | 'updating' | 'uninstalling';

export interface PluginActiveOp {
  package: string;
  action: PluginOpAction;
  startedAt: number;
}

export interface PluginPresetStatus {
  name: string;
  description: string;
  package: string;
  marketplace: string;
  scope: string;
  source?: string;
  marketplaceConfigured: boolean;
  installed: boolean;
  enabled: boolean;
  autoStart: boolean;
  version?: string;
  link?: string;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
