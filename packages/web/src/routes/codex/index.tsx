import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodexSettings } from './settings';
import { CodexMcp } from './mcp';
import { CodexAccounts } from './accounts';
import { CodexAgents } from './agents';
import { CodexSkills } from './skills';
import { CodexVersion } from './version';

export function Codex() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Codex</h1>
      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">设置</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
          <TabsTrigger value="accounts">账号</TabsTrigger>
          <TabsTrigger value="agents">AGENTS.md</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="version">版本</TabsTrigger>
        </TabsList>
        <TabsContent value="settings"><CodexSettings /></TabsContent>
        <TabsContent value="mcp"><CodexMcp /></TabsContent>
        <TabsContent value="accounts"><CodexAccounts /></TabsContent>
        <TabsContent value="agents"><CodexAgents /></TabsContent>
        <TabsContent value="skills"><CodexSkills /></TabsContent>
        <TabsContent value="version"><CodexVersion /></TabsContent>
      </Tabs>
    </div>
  );
}
