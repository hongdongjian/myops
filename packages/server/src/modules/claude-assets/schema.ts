import { z } from 'zod';

export const AssetActionRequestSchema = z.object({
  name: z.string(),
});
export type AssetActionRequest = z.infer<typeof AssetActionRequestSchema>;

export const SkillPresetCreateRequestSchema = z.object({
  name: z.string(),
  desc: z.string().optional(),
  repo: z.string(),
  skill: z.string().optional(),
});
export type SkillPresetCreateRequest = z.infer<typeof SkillPresetCreateRequestSchema>;

export const SkillPresetUpdateRequestSchema = z.object({
  name: z.string(),
  desc: z.string().optional(),
  repo: z.string(),
  skill: z.string().optional(),
});
export type SkillPresetUpdateRequest = z.infer<typeof SkillPresetUpdateRequestSchema>;

export const SkillPresetDeleteRequestSchema = z.object({
  name: z.string(),
});
export type SkillPresetDeleteRequest = z.infer<typeof SkillPresetDeleteRequestSchema>;

export interface AssetItem {
  name: string;
  installed: boolean;
}

export interface SkillPresetDef {
  name: string;
  desc: string;
  repo: string;
  skill?: string;
}

export interface SkillPresetItem {
  name: string;
  desc: string;
  repo: string;
  skill?: string;
  installed: boolean;
  pending?: string;
  error?: string;
}

export const RuleCreateRequestSchema = z.object({
  name: z.string(),
  content: z.string(),
});
export type RuleCreateRequest = z.infer<typeof RuleCreateRequestSchema>;

export const RuleUpdateRequestSchema = z.object({
  name: z.string(),
  content: z.string(),
});
export type RuleUpdateRequest = z.infer<typeof RuleUpdateRequestSchema>;

export const RuleDeleteRequestSchema = z.object({
  name: z.string(),
});
export type RuleDeleteRequest = z.infer<typeof RuleDeleteRequestSchema>;

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
