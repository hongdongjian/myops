import { z } from 'zod';

export const AssetCategorySchema = z.enum(['skills', 'rules', 'commands']);
export type AssetCategory = z.infer<typeof AssetCategorySchema>;

export const AssetSyncRequestSchema = z.object({
  category: AssetCategorySchema,
});
export type AssetSyncRequest = z.infer<typeof AssetSyncRequestSchema>;

export const AssetUninstallRequestSchema = z.object({
  category: AssetCategorySchema,
  name: z.string().min(1),
  removeProject: z.boolean().optional().default(false),
});
export type AssetUninstallRequest = z.infer<typeof AssetUninstallRequestSchema>;

export const AssetListQuerySchema = z.object({
  category: AssetCategorySchema,
});

export const AssetContentQuerySchema = z.object({
  category: AssetCategorySchema,
  source: z.enum(['home', 'project']),
  name: z.string().min(1),
});

export interface AssetEntry {
  name: string;
  isDir: boolean;
  isSymlink?: boolean;
  target?: string;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
