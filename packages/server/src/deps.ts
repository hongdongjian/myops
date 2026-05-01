import type { Paths } from './paths.js';
import type { Runner } from './core/system/runner.js';
import type { StateStore } from './core/process/state.js';
import type { ProcessManager } from './core/process/manager.js';
import type { CopilotAccountsService } from './modules/copilot-accounts/service.js';
import type { CodexAccountView } from './modules/codex-accounts/schema.js';

export interface CodexAccountsHook {
  writeSelectedAuthIfAny(): Promise<void>;
  getAccountViews(): Promise<CodexAccountView[]>;
}

export interface Deps {
  paths: Paths;
  runner: Runner;
  store: StateStore;
  processMgr: ProcessManager;
  copilotAccounts?: CopilotAccountsService;
  codexAccounts?: CodexAccountsHook;
}
