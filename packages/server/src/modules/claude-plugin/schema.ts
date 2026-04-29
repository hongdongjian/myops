import { z } from 'zod';

export const PluginActionRequestSchema = z.object({
  package: z.string(),
});
export type PluginActionRequest = z.infer<typeof PluginActionRequestSchema>;

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

export interface PluginPresetStatus {
  name: string;
  description: string;
  package: string;
  marketplace: string;
  scope: string;
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
