import { z } from 'zod';

export const AssetActionRequestSchema = z.object({
  name: z.string(),
});
export type AssetActionRequest = z.infer<typeof AssetActionRequestSchema>;

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
  installed: boolean;
  pending?: string;
  error?: string;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
