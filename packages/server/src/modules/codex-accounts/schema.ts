import { z } from 'zod';

export const CodexImportJSONRequestSchema = z.object({ content: z.string() });
export const CodexSwitchAccountRequestSchema = z.object({ accountId: z.string() });
export const CodexDeleteAccountRequestSchema = z.object({ accountId: z.string() });
export const CodexAccountRemarkSaveRequestSchema = z.object({
  accountId: z.string(),
  remark: z.string().default(''),
});
export const CodexOAuthCancelRequestSchema = z.object({ loginId: z.string().default('') });

export type CodexImportJSONRequest = z.infer<typeof CodexImportJSONRequestSchema>;
export type CodexSwitchAccountRequest = z.infer<typeof CodexSwitchAccountRequestSchema>;
export type CodexDeleteAccountRequest = z.infer<typeof CodexDeleteAccountRequestSchema>;
export type CodexAccountRemarkSaveRequest = z.infer<typeof CodexAccountRemarkSaveRequestSchema>;
export type CodexOAuthCancelRequest = z.infer<typeof CodexOAuthCancelRequestSchema>;

export interface CodexStoredTokens {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
}

export interface CodexStoredQuota {
  hourlyPercentage: number;
  hourlyResetTime?: number;
  hourlyWindowMinutes?: number;
  hourlyWindowPresent: boolean;
  weeklyPercentage: number;
  weeklyResetTime?: number;
  weeklyWindowMinutes?: number;
  weeklyWindowPresent: boolean;
  codeReviewPercentage?: number;
  codeReviewResetTime?: number;
  codeReviewLabel?: string;
  codeReviewPresent: boolean;
}

export interface CodexQuotaError {
  code?: string;
  message: string;
  timestamp: number;
}

export interface CodexStoredAccount {
  id: string;
  email: string;
  userId?: string;
  remark?: string;
  planType?: string;
  accountId?: string;
  organizationId?: string;
  accountName?: string;
  accountType?: string;
  authProvider?: string;
  quota?: CodexStoredQuota;
  quotaError?: CodexQuotaError;
  quotaUpdatedAt?: number;
  tokens: CodexStoredTokens;
  createdAt: number;
  lastUsedAt: number;
}

export interface CodexAccountStoreFile {
  version: string;
  currentAccountId?: string;
  accounts: CodexStoredAccount[];
}

export interface CodexAccountView {
  id: string;
  email: string;
  userId?: string;
  remark?: string;
  planType?: string;
  accountId?: string;
  organizationId?: string;
  accountName?: string;
  accountType?: string;
  authProvider?: string;
  workspaceTitle?: string;
  workspaceRole?: string;
  quota?: CodexStoredQuota;
  quotaError?: CodexQuotaError;
  quotaUpdatedAt?: number;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
  hasRefreshToken: boolean;
}

export interface CodexAccountIdentity {
  email: string;
  userId: string;
  planType: string;
  accountId: string;
  organizationId: string;
  authProvider: string;
}

export interface CodexOAuthLoginState {
  loginId: string;
  state: string;
  authUrl: string;
  codeVerifier: string;
  redirectUri: string;
  status: 'pending' | 'completed' | 'error' | 'timeout';
  error: string;
  account?: CodexAccountView;
  createdAt: number;
  expiresAt: number;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
