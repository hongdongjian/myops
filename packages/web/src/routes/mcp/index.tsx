import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTabParam } from '@/lib/use-tab-param';
import { XiaohongshuPanel } from './xiaohongshu';

const TAB_VALUES = ['xiaohongshu'] as const;

export function Mcp() {
  const [active, setActive] = useTabParam(TAB_VALUES, 'xiaohongshu');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">MCP</h1>
      <Tabs value={active} onValueChange={setActive}>
        <TabsList>
          <TabsTrigger value="xiaohongshu">Xiaohongshu</TabsTrigger>
        </TabsList>
        <TabsContent value="xiaohongshu">
          <XiaohongshuPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
