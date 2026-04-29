import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  CopilotAccountView,
  CopilotAccountsPayload,
  OAuthStartResponse,
  OAuthStatusResponse,
} from './types';

const formatTime = (ts: number): string => {
  if (!Number.isFinite(ts) || ts <= 0) return '--';
  return new Date(ts).toLocaleString();
};

interface AccountRowProps {
  account: CopilotAccountView;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onRemark: (id: string, remark: string) => void;
  pending: boolean;
}

function AccountRow({ account, onSwitch, onDelete, onRemark, pending }: AccountRowProps) {
  const [editing, setEditing] = useState(false);
  const [remark, setRemark] = useState(account.remark ?? '');

  useEffect(() => {
    if (!editing) setRemark(account.remark ?? '');
  }, [account.remark, editing]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{account.login || account.id}</span>
          {account.current ? <Badge>当前</Badge> : null}
          {account.tokenPreview ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{account.tokenPreview}</span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          首次缓存: {formatTime(account.createdAt)} | 最近活跃: {formatTime(account.lastUsedAt)}
        </div>
        <div className="flex items-center gap-2 pt-1">
          {editing ? (
            <>
              <Input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="备注"
                className="h-7 w-48 text-xs"
              />
              <Button
                size="sm"
                onClick={() => {
                  onRemark(account.id, remark);
                  setEditing(false);
                }}
                disabled={pending}
              >
                保存
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
                取消
              </Button>
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">备注: {account.remark || '--'}</span>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                编辑
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => onSwitch(account.id)}
          disabled={account.current || pending}
        >
          {account.current ? '已切换' : '切换'}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => {
            if (window.confirm(`删除账号 ${account.login || account.id} ?`)) onDelete(account.id);
          }}
          disabled={pending}
        >
          删除
        </Button>
      </div>
    </div>
  );
}

interface OAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}

function OAuthDialog({ open, onOpenChange, onCompleted }: OAuthDialogProps) {
  const [loginId, setLoginId] = useState('');
  const [statusInfo, setStatusInfo] = useState<OAuthStatusResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setLoginId('');
      setStatusInfo(null);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    if (!open || !loginId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await apiGet<OAuthStatusResponse>(
          `/api/copilot/accounts/oauth/status?loginId=${encodeURIComponent(loginId)}`,
        );
        if (cancelled) return;
        setStatusInfo(r);
        if (r.status === 'completed') {
          onCompleted();
          return;
        }
        if (r.status === 'error' || r.status === 'timeout' || r.status === 'missing') {
          setError(r.error || 'OAuth 未完成');
          return;
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
        return;
      }
      if (!cancelled) timer = window.setTimeout(tick, 2000);
    };
    let timer = window.setTimeout(tick, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, loginId, onCompleted]);

  const startMut = useMutation({
    mutationFn: () => apiPost<OAuthStartResponse>('/api/copilot/accounts/oauth/start'),
    onSuccess: (data) => {
      setLoginId(data.loginId);
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>GitHub OAuth 登录</DialogTitle>
          <DialogDescription>
            开始登录后，请在浏览器中输入显示的验证码完成 GitHub 授权。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {!loginId ? (
            <Button onClick={() => startMut.mutate()} disabled={startMut.isPending}>
              {startMut.isPending ? '启动中...' : '开始登录'}
            </Button>
          ) : statusInfo?.status === 'completed' ? (
            <div className="text-green-500">登录完成：{statusInfo.account?.login || ''}</div>
          ) : (
            <div className="space-y-2">
              <div>
                <span className="text-muted-foreground">验证码: </span>
                <span className="font-mono text-base">{statusInfo?.code || '等待中...'}</span>
              </div>
              {statusInfo?.verificationUrl ? (
                <div>
                  <span className="text-muted-foreground">验证 URL: </span>
                  <a
                    href={statusInfo.verificationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {statusInfo.verificationUrl}
                  </a>
                </div>
              ) : null}
              <div className="space-x-3 text-xs text-muted-foreground">
                {statusInfo?.clipboardCopied ? <span>已自动复制</span> : null}
                {statusInfo?.browserOpened ? <span>已自动打开浏览器</span> : null}
              </div>
            </div>
          )}
          {error ? <div className="text-destructive text-xs">{error}</div> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CopilotAccounts() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<CopilotAccountsPayload>({
    queryKey: ['copilot', 'accounts'],
    queryFn: () => apiGet<CopilotAccountsPayload>('/api/copilot/accounts'),
  });

  const switchMut = useMutation({
    mutationFn: (accountId: string) =>
      apiPost('/api/copilot/accounts/switch', { accountId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot'] }),
  });
  const deleteMut = useMutation({
    mutationFn: (accountId: string) =>
      apiPost('/api/copilot/accounts/delete', { accountId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot', 'accounts'] }),
  });
  const remarkMut = useMutation({
    mutationFn: ({ accountId, remark }: { accountId: string; remark: string }) =>
      apiPost('/api/copilot/accounts/remark/save', { accountId, remark }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot', 'accounts'] }),
  });

  const [oauthOpen, setOauthOpen] = useState(false);
  const accounts = data?.accounts ?? [];
  const pending = switchMut.isPending || deleteMut.isPending || remarkMut.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>GitHub 账号管理</span>
          <Button onClick={() => setOauthOpen(true)}>新建账号</Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">加载中...</div>
        ) : accounts.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无缓存账号，点击右上角通过 OAuth 新增。</div>
        ) : (
          accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              pending={pending}
              onSwitch={(id) => switchMut.mutate(id)}
              onDelete={(id) => deleteMut.mutate(id)}
              onRemark={(accountId, remark) => remarkMut.mutate({ accountId, remark })}
            />
          ))
        )}
        <OAuthDialog
          open={oauthOpen}
          onOpenChange={setOauthOpen}
          onCompleted={() => {
            setOauthOpen(false);
            qc.invalidateQueries({ queryKey: ['copilot'] });
          }}
        />
      </CardContent>
    </Card>
  );
}
