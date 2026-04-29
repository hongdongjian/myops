import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ClashTab } from './clash';
import { CloudreveTab } from './cloudreve';
import { ImmichTab } from './immich';

export function Sync() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">同步</h1>
      <Tabs defaultValue="clash">
        <TabsList>
          <TabsTrigger value="clash">Clash</TabsTrigger>
          <TabsTrigger value="cloudreve">Cloudreve</TabsTrigger>
          <TabsTrigger value="immich">Immich</TabsTrigger>
        </TabsList>
        <TabsContent value="clash"><ClashTab /></TabsContent>
        <TabsContent value="cloudreve"><CloudreveTab /></TabsContent>
        <TabsContent value="immich"><ImmichTab /></TabsContent>
      </Tabs>
    </div>
  );
}
