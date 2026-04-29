import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface CodexVersionPayload {
  installed: boolean;
  current: string;
  latest: string;
  canUpgrade: boolean;
  upgradeTarget: string;
  checkError?: string;
}

export function CodexVersion() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<CodexVersionPayload>({
    queryKey: ['codex', 'version'],
    queryFn: () => apiGet<CodexVersionPayload>('/api/codex/version'),
    refetchInterval: 5000,
  });

  const upgrade = useMutation({
    mutationFn: () => apiPost('/api/codex/upgrade'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['codex', 'version'] }),
  });

  const installed = !!data?.installed;
  const canUpgrade = !!data?.canUpgrade;
  const buttonDisabled = upgrade.isPending || (installed && !canUpgrade);
  const buttonLabel = upgrade.isPending ? (installed ? '升级中...' : '安装中...') : installed ? '升级' : '安装';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Codex 版本</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <div className="text-xs text-destructive">{(error as Error).message}</div> : null}
        {isLoading ? <div className="text-xs text-muted-foreground">加载中...</div> : null}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">当前版本</div>
            <div className="font-mono">{installed ? data?.current || '--' : '未安装'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">最新版本</div>
            <div className="font-mono">{data?.latest || '--'}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-muted-foreground">状态</div>
            <div className="flex items-center gap-2">
              {!installed ? (
                <Badge variant="secondary">未安装</Badge>
              ) : canUpgrade ? (
                <Badge className="bg-amber-500 text-white">可升级到 {data?.upgradeTarget || data?.latest}</Badge>
              ) : (
                <Badge className="bg-green-600 text-white">已是最新</Badge>
              )}
              {data?.checkError ? <span className="text-xs text-destructive">{data.checkError}</span> : null}
            </div>
          </div>
        </div>
        <Button onClick={() => upgrade.mutate()} disabled={buttonDisabled}>{buttonLabel}</Button>
      </CardContent>
    </Card>
  );
}
