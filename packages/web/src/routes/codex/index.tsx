import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTabParam } from '@/lib/use-tab-param';
import { CodexSettings } from './settings';
import { CodexMcp } from './mcp';
import { CodexProviders } from './providers';
import { CodexSkills } from './skills';
import { CodexVersion, CodexChangelogPanel } from './version';

const TAB_VALUES = ['version', 'settings', 'providers', 'mcp', 'skills'] as const;

export function Codex() {
  const [active, setActive] = useTabParam(TAB_VALUES, 'version');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Codex</h1>
      <Tabs value={active} onValueChange={setActive}>
        <TabsList>
          <TabsTrigger value="version">Version</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
        </TabsList>
        <TabsContent value="version">
          <div className="space-y-4">
            <CodexVersion />
            <CodexChangelogPanel />
          </div>
        </TabsContent>
        <TabsContent value="settings"><CodexSettings /></TabsContent>
        <TabsContent value="providers"><CodexProviders /></TabsContent>
        <TabsContent value="mcp"><CodexMcp /></TabsContent>
        <TabsContent value="skills"><CodexSkills /></TabsContent>
      </Tabs>
    </div>
  );
}
