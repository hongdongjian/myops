export interface ProcessStatus {
  name: string;
  running: boolean;
  pid: number;
  logPath: string;
  command: string;
  args: string[];
  startedAt: string;
}

export interface VersionStatus {
  installed: boolean;
  current: string;
  latest: string;
  canUpgrade: boolean;
  upgradeTarget: string;
  checkError?: string;
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

export interface CopilotAuthSnapshot {
  accountCount: number;
  hasToken: boolean;
  currentAccount?: CopilotAccountView;
  currentAccountId?: string;
}

export interface CopilotStatus {
  process: ProcessStatus;
  health: { healthy: boolean; state: string };
  version: VersionStatus;
  auth: CopilotAuthSnapshot | null;
  sourceUrl: string;
}

export interface UsageStatus {
  quotaId: string;
  used: number;
  total: number;
  remaining: number;
  percentUsed: number;
  unlimited: boolean;
  resetDate: string;
}

export interface ProxyState {
  enabled: boolean;
  proxyURL?: string;
  restarted?: boolean;
}

export interface AutostartState {
  enabled: boolean;
}

export interface ConfigPayload {
  path: string;
  content: string;
  exists: boolean;
}

export interface ConfigSyncStatus {
  synced: boolean;
  localExists: boolean;
}

export interface CopilotAccountsPayload {
  accounts: CopilotAccountView[];
  currentAccountId: string;
  cachePath?: string;
  authPath?: string;
  hasToken?: boolean;
  restarted?: boolean;
}

export interface OAuthStartResponse {
  loginId: string;
  status: string;
  expiresAt?: number;
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
}
