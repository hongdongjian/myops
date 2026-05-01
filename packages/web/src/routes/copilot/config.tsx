import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/toast';
import type { ConfigPayload, ConfigSyncStatus } from './types';

export function CopilotConfig() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery<ConfigPayload>({
    queryKey: ['copilot', 'config'],
    queryFn: () => apiGet<ConfigPayload>('/api/copilot/config'),
  });
  const { data: syncStatus } = useQuery<ConfigSyncStatus>({
    queryKey: ['copilot', 'config', 'sync-status'],
    queryFn: () => apiGet<ConfigSyncStatus>('/api/copilot/config/sync-status'),
    refetchInterval: 5000,
  });

  const [content, setContent] = useState('');

  useEffect(() => {
    if (data) setContent(data.content ?? '');
  }, [data]);

  const save = useMutation({
    mutationFn: (text: string) => apiPost('/api/copilot/config/save', { content: text }),
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['copilot', 'config'] });
      qc.invalidateQueries({ queryKey: ['copilot', 'config', 'sync-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const sync = useMutation({
    mutationFn: () => apiPost('/api/copilot/config/sync'),
    onSuccess: () => {
      toast.success('Synced');
      qc.invalidateQueries({ queryKey: ['copilot', 'config', 'sync-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => {
    if (content.trim() === '') {
      toast.error('Content cannot be empty');
      return;
    }
    try {
      JSON.parse(content);
    } catch {
      toast.error('JSON parse failed, check format');
      return;
    }
    save.mutate(content);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>copilot-api Config</span>
          {syncStatus ? (
            syncStatus.synced ? (
              <Badge className="bg-green-600 text-white">Synced</Badge>
            ) : (
              <Badge variant="secondary">Not synced</Badge>
            )
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Edit file: <code>{data?.path || 'conf/copilot-api/config.json'}</code>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="h-96 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
          placeholder={isLoading ? 'Loading...' : 'Config JSON'}
        />
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? 'Syncing...' : 'Sync'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
