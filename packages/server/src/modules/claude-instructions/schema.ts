import { z } from 'zod';

export const InstructionsSaveRequestSchema = z.object({
  content: z.string().default(''),
});
export type InstructionsSaveRequest = z.infer<typeof InstructionsSaveRequestSchema>;

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
