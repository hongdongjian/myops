export interface CodexVersionStatus {
  installed: boolean;
  current: string;
  latest: string;
  canUpgrade: boolean;
  upgradeTarget: string;
  checkError?: string;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
