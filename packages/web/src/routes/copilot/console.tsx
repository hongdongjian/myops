import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useStatusPolling } from '@/lib/use-status-polling';
import { StatusBadge } from '@/components/status-badge';
import { LogPanel } from '@/components/log-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CopilotVersion } from './version';
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

  const setAutostart = useMutation({
    mutationFn: (enabled: boolean) => apiPost<AutostartState>('/api/copilot/autostart/set', { enabled }),
    onSuccess: (data) => qc.setQueryData(['copilot', 'autostart'], data),
  });
  const setProxy = useMutation({
    mutationFn: (req: { enabled: boolean; proxyURL?: string }) =>
      apiPost<ProxyState>('/api/copilot/proxy/set', req),
    onSuccess: (data) => {
      qc.setQueryData(['copilot', 'proxy'], data);
      qc.invalidateQueries({ queryKey: ['copilot', 'status'] });
    },
  });

  const [proxyUrlInput, setProxyUrlInput] = useState('');
  useEffect(() => {
    if (proxy?.proxyURL !== undefined) setProxyUrlInput(proxy.proxyURL);
  }, [proxy?.proxyURL]);

  const usageData = (usage ?? {}) as UsageEnvelopeData;
  const unlimited = !!usageData.unlimited;

  return (
    <div className="space-y-4">
      <CopilotVersion />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span>copilot-api</span>
            <StatusBadge running={running} />
            {status?.sourceUrl ? (
              <a
                href={status.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:underline"
              >
                Source
              </a>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => start.mutate()} disabled={running || start.isPending}>Start</Button>
            <Button variant="outline" onClick={() => stop.mutate()} disabled={!running || stop.isPending}>
              Stop
            </Button>
            <Button variant="outline" onClick={() => restart.mutate()} disabled={!running || restart.isPending}>
              Restart
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label className="text-muted-foreground">PID</Label>
              <div className="font-mono">{status?.process?.pid || '--'}</div>
            </div>
            <div>
              <Label className="text-muted-foreground">Health</Label>
              <div className="font-mono">{status?.health?.state || '--'}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-start</Label>
                <p className="text-xs text-muted-foreground">Auto-start copilot-api when service starts</p>
              </div>
              <Switch
                checked={!!autostart?.enabled}
                onCheckedChange={(v) => setAutostart.mutate(v)}
                disabled={setAutostart.isPending}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-3 space-y-1">
                <Label>Enable Proxy</Label>
                <div className="flex gap-2">
                  <Input
                    value={proxyUrlInput}
                    onChange={(e) => setProxyUrlInput(e.target.value)}
                    placeholder="http://127.0.0.1:7897"
                    className="text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setProxy.mutate({ enabled: !!proxy?.enabled, proxyURL: proxyUrlInput })}
                    disabled={setProxy.isPending}
                  >
                    Save
                  </Button>
                </div>
              </div>
              <Switch
                checked={!!proxy?.enabled}
                onCheckedChange={(v) => setProxy.mutate({ enabled: v })}
                disabled={setProxy.isPending}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Usage</span>
            <Button size="sm" variant="outline" onClick={() => refetchUsage()}>
              Refresh
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unlimited ? (
            <div className="text-sm text-muted-foreground">Unlimited</div>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Usage rate</span>
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
                <span>Used: {fmtNum(usageData.used)}</span>
                <span>Total: {fmtNum(usageData.total)}</span>
                <span>Remaining: {fmtNum(usageData.remaining)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current Account</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {status?.auth?.currentAccount ? (
            <div className="space-y-1">
              <div>
                <span className="text-muted-foreground">Login: </span>
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
            <div className="text-muted-foreground">Not logged in. Go to the Accounts tab to sign in.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <LogPanel path="/api/copilot/logs?lines=500" clearPath="/api/copilot/logs/clear" />
        </CardContent>
      </Card>
    </div>
  );
}
