import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ConfigPayload, ConfigSyncStatus } from './types';

export function CopilotConfig() {
  const qc = useQueryClient();
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (data) setContent(data.content ?? '');
  }, [data]);

  const save = useMutation({
    mutationFn: (text: string) => apiPost('/api/copilot/config/save', { content: text }),
    onSuccess: () => {
      setNotice('已保存');
      setError('');
      qc.invalidateQueries({ queryKey: ['copilot', 'config'] });
      qc.invalidateQueries({ queryKey: ['copilot', 'config', 'sync-status'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const sync = useMutation({
    mutationFn: () => apiPost('/api/copilot/config/sync'),
    onSuccess: () => {
      setNotice('已同步');
      setError('');
      qc.invalidateQueries({ queryKey: ['copilot', 'config', 'sync-status'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const handleSave = () => {
    setNotice('');
    setError('');
    if (content.trim() === '') {
      setError('内容不能为空');
      return;
    }
    try {
      JSON.parse(content);
    } catch {
      setError('JSON 解析失败，请检查格式');
      return;
    }
    save.mutate(content);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>copilot-api 配置</span>
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
          编辑文件: <code>{data?.path || 'conf/copilot-api/config.json'}</code>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="h-96 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
          placeholder={isLoading ? '加载中...' : '配置 JSON'}
        />
        {error ? <div className="text-xs text-destructive">{error}</div> : null}
        {notice ? <div className="text-xs text-green-500">{notice}</div> : null}
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? '保存中...' : '保存'}
          </Button>
          <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? '同步中...' : '同步'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
