import { z } from 'zod';

export const CodexAgentsSaveRequestSchema = z.object({
  content: z.string(),
});
export type CodexAgentsSaveRequest = z.infer<typeof CodexAgentsSaveRequestSchema>;

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
