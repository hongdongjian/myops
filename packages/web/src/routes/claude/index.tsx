import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ClaudeSettings } from './settings';
import { ClaudeMcp } from './mcp';
import { ClaudeSkills } from './skills';
import { ClaudeRules } from './rules';
import { ClaudeInstructions } from './instructions';
import { ClaudePlugins } from './plugins';
import { ClaudeProviders } from './providers';
import { ClaudeVersion } from './version';

export function Claude() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Claude</h1>
      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">设置</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="instructions">指令</TabsTrigger>
          <TabsTrigger value="plugins">插件</TabsTrigger>
          <TabsTrigger value="providers">模型路由</TabsTrigger>
          <TabsTrigger value="version">版本</TabsTrigger>
        </TabsList>
        <TabsContent value="settings"><ClaudeSettings /></TabsContent>
        <TabsContent value="mcp"><ClaudeMcp /></TabsContent>
        <TabsContent value="skills"><ClaudeSkills /></TabsContent>
        <TabsContent value="rules"><ClaudeRules /></TabsContent>
        <TabsContent value="instructions"><ClaudeInstructions /></TabsContent>
        <TabsContent value="plugins"><ClaudePlugins /></TabsContent>
        <TabsContent value="providers"><ClaudeProviders /></TabsContent>
        <TabsContent value="version"><ClaudeVersion /></TabsContent>
      </Tabs>
    </div>
  );
}
