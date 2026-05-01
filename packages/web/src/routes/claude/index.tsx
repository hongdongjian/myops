import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTabParam } from '@/lib/use-tab-param';
import { ClaudeSettings } from './settings';
import { ClaudeMcp } from './mcp';
import { ClaudeSkills } from './skills';
import { ClaudeRules } from './rules';
import { ClaudePlugins } from './plugins';
import { ClaudeProviders } from './providers';
import { ClaudeVersion } from './version';
import { ChangelogPanel } from './version';

const TAB_VALUES = ['version', 'settings', 'providers', 'plugins', 'mcp', 'skills', 'rules'] as const;

export function Claude() {
  const [active, setActive] = useTabParam(TAB_VALUES, 'version');

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Claude</h1>
      <Tabs value={active} onValueChange={setActive}>
        <TabsList>
          <TabsTrigger value="version">Version</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="providers">Provider</TabsTrigger>
          <TabsTrigger value="plugins">Plugins</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>
        <TabsContent value="version">
          <div className="space-y-4">
            <ClaudeVersion />
            <ChangelogPanel />
          </div>
        </TabsContent>
        <TabsContent value="settings"><ClaudeSettings /></TabsContent>
        <TabsContent value="providers"><ClaudeProviders /></TabsContent>
        <TabsContent value="plugins"><ClaudePlugins /></TabsContent>
        <TabsContent value="mcp"><ClaudeMcp /></TabsContent>
        <TabsContent value="skills"><ClaudeSkills /></TabsContent>
        <TabsContent value="rules"><ClaudeRules /></TabsContent>
      </Tabs>
    </div>
  );
}
