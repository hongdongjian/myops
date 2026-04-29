import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PresetStatus {
  name: string;
  description: string;
  installed: boolean;
}

interface CodexMCPListPayload {
  paths: { user: string; userExists: boolean };
  installed: { user: string[] };
  supported: PresetStatus[];
  others: { user: string[] };
}

export function CodexMcp() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<CodexMCPListPayload>({
    queryKey: ['codex', 'mcp', 'list'],
    queryFn: () => apiGet<CodexMCPListPayload>('/api/codex/mcp/list'),
  });

  const [actionMsg, setActionMsg] = useState('');
  const [actionErr, setActionErr] = useState('');

  const install = useMutation({
    mutationFn: (name: string) => apiPost('/api/codex/mcp/preset/install', { name }),
    onSuccess: () => {
      setActionMsg('安装完成');
      setActionErr('');
      qc.invalidateQueries({ queryKey: ['codex', 'mcp', 'list'] });
    },
    onError: (e: Error) => setActionErr(e.message),
  });
  const remove = useMutation({
    mutationFn: (name: string) => apiPost('/api/codex/mcp/preset/remove', { name }),
    onSuccess: () => {
      setActionMsg('卸载完成');
      setActionErr('');
      qc.invalidateQueries({ queryKey: ['codex', 'mcp', 'list'] });
    },
    onError: (e: Error) => setActionErr(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>预置 MCP</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            <code>{data?.paths.user || '~/.codex/config.toml'}</code> {data?.paths.userExists ? '' : '(尚未生成)'}
          </div>
          {error ? <div className="text-xs text-destructive">{(error as Error).message}</div> : null}
          {isLoading ? <div className="text-xs text-muted-foreground">加载中...</div> : null}
          <div className="space-y-2">
            {(data?.supported ?? []).map((p) => (
              <div key={p.name} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                  <div className="text-xs text-muted-foreground">{p.installed ? '✓ 已安装' : '未安装'}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => install.mutate(p.name)} disabled={install.isPending}>安装</Button>
                  <Button size="sm" variant="outline" onClick={() => remove.mutate(p.name)} disabled={!p.installed || remove.isPending}>卸载</Button>
                </div>
              </div>
            ))}
            {(data?.supported ?? []).length === 0 && !isLoading ? (
              <div className="text-xs text-muted-foreground">无预置 MCP</div>
            ) : null}
          </div>
          {actionMsg ? <div className="text-xs text-green-500">{actionMsg}</div> : null}
          {actionErr ? <div className="text-xs text-destructive">{actionErr}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>已安装 MCP</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data?.installed?.user ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">暂无已安装 MCP</div>
          ) : (
            (data?.installed?.user ?? []).map((n) => (
              <div key={n} className="flex items-center justify-between rounded border border-border px-2 py-1 text-sm">
                <code>{n}</code>
                <Button size="sm" variant="outline" onClick={() => remove.mutate(n)} disabled={remove.isPending}>移除</Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
