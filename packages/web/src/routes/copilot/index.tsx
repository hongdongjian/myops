import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CopilotConsole } from './console';
import { CopilotAccounts } from './accounts';
import { CopilotConfig } from './config';

export function Copilot() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Copilot</h1>
      <Tabs defaultValue="console">
        <TabsList>
          <TabsTrigger value="console">控制台</TabsTrigger>
          <TabsTrigger value="accounts">账号</TabsTrigger>
          <TabsTrigger value="config">配置</TabsTrigger>
        </TabsList>
        <TabsContent value="console">
          <CopilotConsole />
        </TabsContent>
        <TabsContent value="accounts">
          <CopilotAccounts />
        </TabsContent>
        <TabsContent value="config">
          <CopilotConfig />
        </TabsContent>
      </Tabs>
    </div>
  );
}
