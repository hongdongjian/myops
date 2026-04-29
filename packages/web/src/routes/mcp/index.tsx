import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { useStatusPolling } from '@/lib/use-status-polling';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/status-badge';
import { LogPanel } from '@/components/log-panel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface XHSStatus {
  process?: { running?: boolean; pid?: number };
  health?: { healthy?: boolean; state?: string; error?: string };
  auth?: { hasCookie?: boolean; cookieFile?: string; actionLabel?: string };
  package?: {
    loginBinaryExists?: boolean;
    serverBinaryExists?: boolean;
  };
}

interface AutostartState {
  enabled: boolean;
}

interface CommandResult {
  stdout?: string;
  stderr?: string;
  removedCookies?: number;
}

export function Mcp() {
  const qc = useQueryClient();
  const { data: status } = useStatusPolling<XHSStatus>(
    ['mcp', 'status'],
    '/api/mcp/xiaohongshu/status',
    2000,
  );
  const { data: autostart } = useQuery<AutostartState>({
    queryKey: ['mcp', 'autostart'],
    queryFn: () => apiGet<AutostartState>('/api/mcp/xiaohongshu/autostart'),
  });

  const running = !!status?.process?.running;

  const start = useMutation({
    mutationFn: () => apiPost('/api/mcp/xiaohongshu/start'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp'] }),
  });
  const stop = useMutation({
    mutationFn: () => apiPost('/api/mcp/xiaohongshu/stop'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp'] }),
  });
  const restart = useMutation({
    mutationFn: () => apiPost('/api/mcp/xiaohongshu/restart'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp'] }),
  });
  const setAutostart = useMutation({
    mutationFn: (enabled: boolean) =>
      apiPost<AutostartState>('/api/mcp/xiaohongshu/autostart/set', { enabled }),
    onSuccess: (data) => qc.setQueryData(['mcp', 'autostart'], data),
  });

  const [loginDialog, setLoginDialog] = useState<CommandResult | null>(null);
  const [registerDialog, setRegisterDialog] = useState<CommandResult | null>(null);
  const [copyDialog, setCopyDialog] = useState<{ message?: string; error?: string } | null>(null);

  const login = useMutation({
    mutationFn: () => apiPost<CommandResult>('/api/mcp/xiaohongshu/login'),
    onSuccess: (data) => setLoginDialog(data),
    onError: (e: Error) => setLoginDialog({ stderr: e.message }),
  });
  const copyPackage = useMutation({
    mutationFn: () => apiPost<{ message?: string }>('/api/mcp/xiaohongshu/copy-package'),
    onSuccess: (data) => setCopyDialog({ message: '已复制：' + JSON.stringify(data) }),
    onError: (e: Error) => setCopyDialog({ error: e.message }),
  });
  const registerToClaude = useMutation({
    mutationFn: () => apiPost<CommandResult>('/api/mcp/xiaohongshu/register'),
    onSuccess: (data) => setRegisterDialog(data),
    onError: (e: Error) => setRegisterDialog({ stderr: e.message }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">MCP · 小红书</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span>小红书 MCP Server</span>
            <StatusBadge running={running} />
            {status?.health?.error ? (
              <span className="text-xs text-destructive">{status.health.error}</span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => start.mutate()} disabled={running || start.isPending}>
              启动
            </Button>
            <Button variant="outline" onClick={() => stop.mutate()} disabled={!running || stop.isPending}>
              停止
            </Button>
            <Button variant="outline" onClick={() => restart.mutate()} disabled={!running || restart.isPending}>
              重启
            </Button>
            <Button variant="outline" onClick={() => login.mutate()} disabled={login.isPending}>
              {login.isPending ? '登录中...' : status?.auth?.actionLabel || '登录'}
            </Button>
            <Button variant="outline" onClick={() => copyPackage.mutate()} disabled={copyPackage.isPending}>
              复制安装包
            </Button>
            <Button
              variant="outline"
              onClick={() => registerToClaude.mutate()}
              disabled={registerToClaude.isPending}
            >
              注册到 Claude
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label className="text-muted-foreground">PID</Label>
              <div className="font-mono">{status?.process?.pid || '--'}</div>
            </div>
            <div>
              <Label className="text-muted-foreground">健康状态</Label>
              <div className="font-mono">{status?.health?.state || '--'}</div>
            </div>
            <div>
              <Label className="text-muted-foreground">登录态</Label>
              <div className="font-mono">{status?.auth?.hasCookie ? '已登录' : '未登录'}</div>
            </div>
            <div>
              <Label className="text-muted-foreground">二进制</Label>
              <div className="font-mono text-xs">
                login: {status?.package?.loginBinaryExists ? '✓' : '✗'} | server:{' '}
                {status?.package?.serverBinaryExists ? '✓' : '✗'}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-4">
            <div>
              <Label>自动启动</Label>
              <p className="text-xs text-muted-foreground">服务启动时自动拉起 MCP</p>
            </div>
            <Switch
              checked={!!autostart?.enabled}
              onCheckedChange={(v) => setAutostart.mutate(v)}
              disabled={setAutostart.isPending}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>日志</CardTitle>
        </CardHeader>
        <CardContent>
          <LogPanel
            path="/api/mcp/xiaohongshu/logs?lines=300"
            clearPath="/api/mcp/xiaohongshu/logs/clear"
          />
        </CardContent>
      </Card>

      <Dialog open={!!loginDialog} onOpenChange={(o) => !o && setLoginDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登录结果</DialogTitle>
            <DialogDescription>命令执行结果</DialogDescription>
          </DialogHeader>
          <pre className="max-h-80 overflow-auto rounded bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
            {loginDialog?.stdout || ''}
            {loginDialog?.stderr ? `\n${loginDialog.stderr}` : ''}
          </pre>
        </DialogContent>
      </Dialog>

      <Dialog open={!!registerDialog} onOpenChange={(o) => !o && setRegisterDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>注册结果</DialogTitle>
            <DialogDescription>已尝试将 xiaohongshu MCP 注册到 Claude</DialogDescription>
          </DialogHeader>
          <pre className="max-h-80 overflow-auto rounded bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
            {registerDialog?.stdout || ''}
            {registerDialog?.stderr ? `\n${registerDialog.stderr}` : ''}
          </pre>
        </DialogContent>
      </Dialog>

      <Dialog open={!!copyDialog} onOpenChange={(o) => !o && setCopyDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>复制安装包</DialogTitle>
          </DialogHeader>
          <div className="text-sm">
            {copyDialog?.error ? (
              <span className="text-destructive">{copyDialog.error}</span>
            ) : (
              copyDialog?.message
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
