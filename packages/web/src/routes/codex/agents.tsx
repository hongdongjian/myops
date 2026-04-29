import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface AgentsPayload {
  path: string;
  syncedPath: string;
  content: string;
  exists: boolean;
}

interface SyncStatusPayload {
  synced: boolean;
  localExists: boolean;
}

export function CodexAgents() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<AgentsPayload>({
    queryKey: ['codex', 'agents'],
    queryFn: () => apiGet<AgentsPayload>('/api/codex/agents'),
  });
  const { data: syncStatus } = useQuery<SyncStatusPayload>({
    queryKey: ['codex', 'agents', 'sync-status'],
    queryFn: () => apiGet<SyncStatusPayload>('/api/codex/agents/sync-status'),
    refetchInterval: 5000,
  });

  const [content, setContent] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (data) setContent(data.content ?? '');
  }, [data]);

  const save = useMutation({
    mutationFn: (text: string) => apiPost('/api/codex/agents/save', { content: text }),
    onSuccess: () => {
      setNotice('已保存');
      setError('');
      qc.invalidateQueries({ queryKey: ['codex', 'agents'] });
      qc.invalidateQueries({ queryKey: ['codex', 'agents', 'sync-status'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const sync = useMutation({
    mutationFn: () => apiPost('/api/codex/agents/sync'),
    onSuccess: () => {
      setNotice('已同步到 ~/.codex/AGENTS.md');
      setError('');
      qc.invalidateQueries({ queryKey: ['codex', 'agents', 'sync-status'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>AGENTS.md</span>
          {syncStatus ? (
            syncStatus.synced ? (
              <Badge className="bg-green-600 text-white">已同步</Badge>
            ) : (
              <Badge variant="secondary">未同步</Badge>
            )
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          本地: <code>{data?.path || 'conf/codex/AGENTS.md'}</code> · 同步到: <code>{data?.syncedPath || '~/.codex/AGENTS.md'}</code>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="h-[480px] w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
          placeholder={isLoading ? '加载中...' : '在此填写 AGENTS.md 内容'}
        />
        {notice ? <div className="text-xs text-green-500">{notice}</div> : null}
        {error ? <div className="text-xs text-destructive">{error}</div> : null}
        <div className="flex gap-2">
          <Button onClick={() => save.mutate(content)} disabled={save.isPending}>
            {save.isPending ? '保存中...' : '保存'}
          </Button>
          <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending || !syncStatus?.localExists}>
            {sync.isPending ? '同步中...' : '同步'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
