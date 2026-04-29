import type { Config } from './config/schema.js';
import type { Paths } from './paths.js';
import type { Runner } from './core/system/runner.js';
import type { StateStore } from './core/process/state.js';
import type { ProcessManager } from './core/process/manager.js';
import type { CopilotAccountsService } from './modules/copilot-accounts/service.js';

export interface CodexAccountsHook {
  writeSelectedAuthIfAny(): Promise<void>;
}

export interface Deps {
  config: Config;
  paths: Paths;
  runner: Runner;
  store: StateStore;
  processMgr: ProcessManager;
  copilotAccounts?: CopilotAccountsService;
  codexAccounts?: CodexAccountsHook;
}
