import { z } from 'zod';

export const ClashGroupSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  proxies: z.array(z.string()).default([]),
});
export type ClashGroup = z.infer<typeof ClashGroupSchema>;

export const ClashRuleSetSchema = z.object({
  name: z.string().min(1),
  group: z.string().min(1),
  rules: z.array(z.string()).default([]),
});
export type ClashRuleSet = z.infer<typeof ClashRuleSetSchema>;

export const ClashConfigSchema = z.object({
  subscribe_url: z.string().default(''),
  groups: z.array(ClashGroupSchema).default([]),
  rule_sets: z.array(ClashRuleSetSchema).default([]),
});
export type ClashConfig = z.infer<typeof ClashConfigSchema>;

export interface ClashUpstreamInfo {
  proxies: string[];
  groups: string[];
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
