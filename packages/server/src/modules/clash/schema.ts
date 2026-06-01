import { z } from 'zod';

export const CLASH_GROUPS = ['list', 'icon'] as const;
export type ClashResourceGroup = (typeof CLASH_GROUPS)[number];

export const ClashResourceGroupSchema = z.enum(CLASH_GROUPS);

export const ClashProxySchema = z.object({
  name: z.string().min(1),
}).passthrough();
export type ClashProxy = z.infer<typeof ClashProxySchema>;

export const ClashRuleBehaviorSchema = z.enum(['classical', 'domain', 'ipcidr']);
export type ClashRuleBehavior = z.infer<typeof ClashRuleBehaviorSchema>;

export const ClashCustomRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  target_group: z.string().min(1),
  behavior: ClashRuleBehaviorSchema.default('classical'),
  rules: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});
export type ClashCustomRule = z.infer<typeof ClashCustomRuleSchema>;

export const ClashConfigSchema = z.object({
  api_key: z.string().optional(),
  public_base_url: z.string().optional(),
  custom_proxies: z.array(ClashProxySchema).default([]),
  custom_rules: z.array(ClashCustomRuleSchema).default([]),
});
export type ClashConfig = z.infer<typeof ClashConfigSchema>;

export const ClashResourceSchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1),
  source: z.enum(['remote', 'manual', 'local']),
  size: z.number().int().min(0).optional(),
  updatedAt: z.number().int().optional(),
  error: z.string().optional(),
});
export type ClashResource = z.infer<typeof ClashResourceSchema>;

export type ClashManifest = Record<ClashResourceGroup, ClashResource[]>;

export function emptyManifest(): ClashManifest {
  return { list: [], icon: [] };
}

export const RefreshBodySchema = z.object({
  group: ClashResourceGroupSchema.optional(),
  url: z.string().url().optional(),
});
export type RefreshBody = z.infer<typeof RefreshBodySchema>;

export const AddBodySchema = z.object({
  group: ClashResourceGroupSchema,
  url: z.string().url(),
});

export const DeleteBodySchema = z.object({
  group: ClashResourceGroupSchema,
  filename: z.string().min(1),
});

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
