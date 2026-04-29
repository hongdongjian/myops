import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { useStatusPolling } from '@/lib/use-status-polling';
import { StatusBadge } from '@/components/status-badge';
import { LogPanel } from '@/components/log-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type {
  AutostartState,
  CopilotStatus,
  ProxyState,
  UsageStatus,
} from './types';

interface UsageEnvelopeData {
  unlimited?: boolean;
  used?: number;
  total?: number;
  remaining?: number;
  percentUsed?: number;
}

const fmtNum = (v: unknown): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '--';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

export function CopilotConsole() {
  const qc = useQueryClient();
  const { data: status } = useStatusPolling<CopilotStatus>(
    ['copilot', 'status'],
    '/api/copilot/status',
    2000,
  );
  const { data: usage, refetch: refetchUsage } = useQuery<UsageEnvelopeData | UsageStatus>({
    queryKey: ['copilot', 'usage'],
    queryFn: () => apiGet<UsageEnvelopeData>('/api/copilot/usage'),
    refetchInterval: 600000,
  });
  const { data: autostart } = useQuery<AutostartState>({
    queryKey: ['copilot', 'autostart'],
    queryFn: () => apiGet<AutostartState>('/api/copilot/autostart'),
  });
  const { data: proxy } = useQuery<ProxyState>({
    queryKey: ['copilot', 'proxy'],
    queryFn: () => apiGet<ProxyState>('/api/copilot/proxy'),
  });

  const running = !!status?.process?.running;
  const version = status?.version;

  const start = useMutation({
    mutationFn: () => apiPost('/api/copilot/start'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot'] }),
  });
  const stop = useMutation({
    mutationFn: () => apiPost('/api/copilot/stop'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot'] }),
  });
  const restart = useMutation({
    mutationFn: () => apiPost('/api/copilot/restart'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot'] }),
  });
  const upgrade = useMutation({
    mutationFn: () => apiPost('/api/copilot/upgrade'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot'] }),
  });

  const setAutostart = useMutation({
    mutationFn: (enabled: boolean) => apiPost<AutostartState>('/api/copilot/autostart/set', { enabled }),
    onSuccess: (data) => qc.setQueryData(['copilot', 'autostart'], data),
  });
  const setProxy = useMutation({
    mutationFn: (enabled: boolean) => apiPost<ProxyState>('/api/copilot/proxy/set', { enabled }),
    onSuccess: (data) => {
      qc.setQueryData(['copilot', 'proxy'], data);
      qc.invalidateQueries({ queryKey: ['copilot', 'status'] });
    },
  });

  const usageData = (usage ?? {}) as UsageEnvelopeData;
  const unlimited = !!usageData.unlimited;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span>copilot-api 服务管理</span>
            <StatusBadge running={running} />
            {status?.sourceUrl ? (
              <a
                href={status.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:underline"
              >
                源码
              </a>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => start.mutate()} disabled={running || start.isPending}>启动</Button>
            <Button variant="outline" onClick={() => stop.mutate()} disabled={!running || stop.isPending}>
              停止
            </Button>
            <Button variant="outline" onClick={() => restart.mutate()} disabled={!running || restart.isPending}>
              重启
            </Button>
            <Button variant="outline" onClick={() => upgrade.mutate()} disabled={upgrade.isPending}>
              {upgrade.isPending ? '升级中...' : version?.canUpgrade ? `升级到 ${version.upgradeTarget}` : '升级'}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label className="text-muted-foreground">版本</Label>
              <div className="font-mono">{version?.current || '--'}</div>
            </div>
            <div>
              <Label className="text-muted-foreground">PID</Label>
              <div className="font-mono">{status?.process?.pid || '--'}</div>
            </div>
            <div>
              <Label className="text-muted-foreground">最新版本</Label>
              <div className="font-mono">{version?.latest || '--'}</div>
            </div>
            <div>
              <Label className="text-muted-foreground">健康状态</Label>
              <div className="font-mono">{status?.health?.state || '--'}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>自动启动</Label>
                <p className="text-xs text-muted-foreground">服务启动时自动拉起 copilot-api</p>
              </div>
              <Switch
                checked={!!autostart?.enabled}
                onCheckedChange={(v) => setAutostart.mutate(v)}
                disabled={setAutostart.isPending}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>启用代理</Label>
                <p className="text-xs text-muted-foreground break-all">{proxy?.proxyURL || '未配置代理'}</p>
              </div>
              <Switch
                checked={!!proxy?.enabled}
                onCheckedChange={(v) => setProxy.mutate(v)}
                disabled={setProxy.isPending}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>使用量</span>
            <Button size="sm" variant="outline" onClick={() => refetchUsage()}>
              刷新
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unlimited ? (
            <div className="text-sm text-muted-foreground">无限制</div>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>已使用率</span>
                <span className="font-mono">
                  {Number.isFinite(Number(usageData.percentUsed))
                    ? `${Number(usageData.percentUsed).toFixed(2)}%`
                    : '--'}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(0, Number(usageData.percentUsed) || 0))}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>已使用: {fmtNum(usageData.used)}</span>
                <span>总量: {fmtNum(usageData.total)}</span>
                <span>剩余: {fmtNum(usageData.remaining)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>当前账号</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {status?.auth?.currentAccount ? (
            <div className="space-y-1">
              <div>
                <span className="text-muted-foreground">登录: </span>
                <span className="font-mono">{status.auth.currentAccount.login}</span>
              </div>
              {status.auth.currentAccount.tokenPreview ? (
                <div>
                  <span className="text-muted-foreground">Token: </span>
                  <span className="font-mono">{status.auth.currentAccount.tokenPreview}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-muted-foreground">未登录，请前往「账号」标签页登录。</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>日志</CardTitle>
        </CardHeader>
        <CardContent>
          <LogPanel path="/api/copilot/logs?lines=500" clearPath="/api/copilot/logs/clear" />
        </CardContent>
      </Card>
    </div>
  );
}
