import { z } from 'zod';

export const SkillActionRequestSchema = z.object({
  name: z.string().min(1),
});

export type SkillActionRequest = z.infer<typeof SkillActionRequestSchema>;

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: { code: string; message: string };
}
