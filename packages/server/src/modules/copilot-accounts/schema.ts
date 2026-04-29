import { z } from 'zod';

export const COPILOT_ACCOUNTS_STORE_VERSION = '1.0';

export interface CopilotStoredAccount {
  id: string;
  login: string;
  remark?: string;
  githubToken: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface CopilotAccountStoreFile {
  version: string;
  currentAccountId?: string;
  accounts: CopilotStoredAccount[];
}

export interface CopilotAccountView {
  id: string;
  login: string;
  remark?: string;
  tokenPreview?: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

export interface CopilotAccountsPayload {
  accounts: CopilotAccountView[];
  currentAccountId: string;
  cachePath: string;
  authPath: string;
  currentCachePath: string;
  hasToken: boolean;
  currentAccount?: CopilotAccountView;
  switchedAccount?: CopilotAccountView;
  remarkedAccount?: CopilotAccountView;
  restarted?: boolean;
}

export interface CopilotAuthSnapshot {
  accountCount: number;
  hasToken: boolean;
  currentAccount?: CopilotAccountView;
  currentAccountId?: string;
}

export const SwitchAccountRequestSchema = z.object({
  accountId: z.string(),
});
export type SwitchAccountRequest = z.infer<typeof SwitchAccountRequestSchema>;

export const DeleteAccountRequestSchema = z.object({
  accountId: z.string(),
});
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequestSchema>;

export const RemarkSaveRequestSchema = z.object({
  accountId: z.string(),
  remark: z.string(),
});
export type RemarkSaveRequest = z.infer<typeof RemarkSaveRequestSchema>;

export const OAuthStatusQuerySchema = z.object({
  loginId: z.string(),
});
export type OAuthStatusQuery = z.infer<typeof OAuthStatusQuerySchema>;

export interface OAuthStartResponse {
  loginId: string;
  status: string;
  expiresAt: number;
}

export interface OAuthStatusResponse {
  loginId: string;
  status: string;
  error?: string;
  code?: string;
  verificationUrl?: string;
  clipboardCopied?: boolean;
  browserOpened?: boolean;
  serviceAction?: string;
  serviceError?: string;
  account?: CopilotAccountView;
  expiresAt?: number;
}
