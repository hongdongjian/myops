import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTabParam } from '@/lib/use-tab-param';
import { CopilotVersion } from './version';
import { CopilotSettings } from './settings';
import { CopilotAccounts } from './accounts';
import { CopilotLog } from './log';

const TAB_VALUES = ['version', 'settings', 'accounts', 'log'] as const;

export function Copilot() {
  const [active, setActive] = useTabParam(TAB_VALUES, 'version');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Copilot</h1>
      <Tabs value={active} onValueChange={setActive}>
        <TabsList>
          <TabsTrigger value="version">Version</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>
        <TabsContent value="version">
          <CopilotVersion />
        </TabsContent>
        <TabsContent value="settings">
          <CopilotSettings />
        </TabsContent>
        <TabsContent value="accounts">
          <CopilotAccounts />
        </TabsContent>
        <TabsContent value="log">
          <CopilotLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}
