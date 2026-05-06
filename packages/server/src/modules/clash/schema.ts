import { z } from 'zod';

export const ClashProxySchema = z.object({
  name: z.string().min(1),
}).passthrough();
export type ClashProxy = z.infer<typeof ClashProxySchema>;

export const ClashGroupSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  proxies: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  inject_into: z.array(z.string()).default([]),
  url: z.string().optional(),
  interval: z.number().int().min(1).optional(),
  timeout: z.number().int().min(1).optional(),
  tolerance: z.number().int().min(0).optional(),
  lazy: z.boolean().optional(),
  max_failed_times: z.number().int().min(0).optional(),
  strategy: z.string().optional(),
});
export type ClashGroup = z.infer<typeof ClashGroupSchema>;

export const ClashRuleSetSchema = z.object({
  name: z.string().min(1),
  group: z.string().min(1),
  rules: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});
export type ClashRuleSet = z.infer<typeof ClashRuleSetSchema>;

export const ClashConfigSchema = z.object({
  subscribe_url: z.string().default(''),
  refresh_interval_minutes: z.number().int().min(1).default(60),
  api_key: z.string().optional(),
  custom_proxies: z.array(ClashProxySchema).default([]),
  groups: z.array(ClashGroupSchema).default([]),
  rule_sets: z.array(ClashRuleSetSchema).default([]),
});
export type ClashConfig = z.infer<typeof ClashConfigSchema>;

export interface ClashUpstreamInfo {
  proxies: string[];
  groups: string[];
  fetchedAt?: number;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
