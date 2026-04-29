import { z } from 'zod';

export const VersionOperationStatusSchema = z.object({
  running: z.boolean(),
  action: z.string().optional(),
  startedAt: z.string().optional(),
});
export type VersionOperationStatus = z.infer<typeof VersionOperationStatusSchema>;

export interface VersionStatus {
  installed: boolean;
  current: string;
  latest: string;
  canUpgrade: boolean;
  upgradeTarget: string;
  checkError?: string;
  operation?: VersionOperationStatus | null;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
