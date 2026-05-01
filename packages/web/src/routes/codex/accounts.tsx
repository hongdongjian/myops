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

interface CodexAccountView {
  id: string;
  email: string;
  remark?: string;
  planType?: string;
  accountName?: string;
  workspaceTitle?: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

interface CodexAccountsPayload {
  accounts: CodexAccountView[];
  currentAccountId: string;
  authMode: boolean;
  authPath: string;
  cachePath: string;
  hasLocalAuth?: boolean;
}

interface OAuthStartResponse {
  loginId: string;
  authUrl: string;
  status: string;
}

interface OAuthStatusResponse {
  loginId: string;
  status: string;
  error?: string;
  authUrl?: string;
  account?: CodexAccountView;
}

const formatTime = (ts: number): string => {
  if (!Number.isFinite(ts) || ts <= 0) return '--';
  return new Date(ts).toLocaleString();
};

interface AccountRowProps {
  account: CodexAccountView;
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
          <span className="font-mono text-sm">{account.email || account.id}</span>
          {account.current ? <Badge>Active</Badge> : null}
          {account.planType ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{account.planType}</span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {account.accountName ? `${account.accountName} · ` : ''}
          {account.workspaceTitle ? `${account.workspaceTitle} · ` : ''}
          Created: {formatTime(account.createdAt)} | Last active: {formatTime(account.lastUsedAt)}
        </div>
        <div className="flex items-center gap-2 pt-1">
          {editing ? (
            <>
              <Input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Remark"
                className="h-7 w-48 text-xs"
              />
              <Button size="sm" onClick={() => { onRemark(account.id, remark); setEditing(false); }} disabled={pending}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>Cancel</Button>
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">Remark: {account.remark || '--'}</span>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
            </>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSwitch(account.id)} disabled={account.current || pending}>
          {account.current ? 'Active' : 'Apply'}
        </Button>
        <Button size="sm" variant="destructive"
          onClick={() => { if (window.confirm(`Delete account ${account.email || account.id}?`)) onDelete(account.id); }}
          disabled={pending}>
          Delete
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
  const [info, setInfo] = useState<OAuthStatusResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setLoginId('');
      setInfo(null);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    if (!open || !loginId) return;
    let cancelled = false;
    let timer = 0 as unknown as ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await apiGet<OAuthStatusResponse>(
          `/api/codex/accounts/oauth/status?loginId=${encodeURIComponent(loginId)}`,
        );
        if (cancelled) return;
        setInfo(r);
        if (r.status === 'completed') { onCompleted(); return; }
        if (r.status === 'error' || r.status === 'timeout') { setError(r.error || 'OAuth not completed'); return; }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
        return;
      }
      if (!cancelled) timer = setTimeout(tick, 2000);
    };
    timer = setTimeout(tick, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, loginId, onCompleted]);

  const cancel = useMutation({
    mutationFn: () => apiPost('/api/codex/accounts/oauth/cancel', { loginId }),
  });

  const start = useMutation({
    mutationFn: () => apiPost<OAuthStartResponse>('/api/codex/accounts/oauth/start'),
    onSuccess: (r) => {
      setLoginId(r.loginId);
      setError('');
      if (r.authUrl) window.open(r.authUrl, '_blank', 'noreferrer');
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && loginId) cancel.mutate(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Codex OAuth Login</DialogTitle>
          <DialogDescription>After starting login, an OpenAI authorization page will open in your browser.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {!loginId ? (
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              {start.isPending ? 'Starting...' : 'Start Login'}
            </Button>
          ) : info?.status === 'completed' ? (
            <div className="text-green-500">Login completed: {info.account?.email || ''}</div>
          ) : (
            <div className="space-y-2">
              <div className="text-muted-foreground">Status: {info?.status || 'Waiting...'}</div>
              {info?.authUrl ? (
                <div>
                  <a href={info.authUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">
                    {info.authUrl}
                  </a>
                </div>
              ) : null}
            </div>
          )}
          {error ? <div className="text-destructive text-xs">{error}</div> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CodexAccounts() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<CodexAccountsPayload>({
    queryKey: ['codex', 'accounts'],
    queryFn: () => apiGet<CodexAccountsPayload>('/api/codex/accounts'),
  });

  const applyMut = useMutation({
    mutationFn: (accountId: string) => apiPost('/api/codex/accounts/apply', { accountId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['codex'] });
    },
  });
  const switchMut = useMutation({
    mutationFn: (accountId: string) => apiPost('/api/codex/accounts/switch', { accountId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['codex'] }),
  });
  const deleteMut = useMutation({
    mutationFn: (accountId: string) => apiPost('/api/codex/accounts/delete', { accountId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['codex', 'accounts'] }),
  });
  const remarkMut = useMutation({
    mutationFn: ({ accountId, remark }: { accountId: string; remark: string }) =>
      apiPost('/api/codex/accounts/remark/save', { accountId, remark }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['codex', 'accounts'] }),
  });
  const importLocal = useMutation({
    mutationFn: () => apiPost('/api/codex/accounts/import-local'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['codex', 'accounts'] }),
  });

  const [oauthOpen, setOauthOpen] = useState(false);
  const accounts = data?.accounts ?? [];
  const pending = applyMut.isPending || switchMut.isPending || deleteMut.isPending || remarkMut.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Login Accounts</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => importLocal.mutate()} disabled={importLocal.isPending}>
              {importLocal.isPending ? 'Importing...' : 'Import local auth'}
            </Button>
            <Button onClick={() => setOauthOpen(true)}>OAuth Login</Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Cache: <code>{data?.cachePath || 'data/codex/accounts.json'}</code> · Write: <code>{data?.authPath || '~/.codex/auth.json'}</code>
        </div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : accounts.length === 0 ? (
          <div className="text-sm text-muted-foreground">No cached accounts. Add one via OAuth.</div>
        ) : (
          accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              pending={pending}
              onSwitch={(id) => applyMut.mutate(id)}
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
            qc.invalidateQueries({ queryKey: ['codex'] });
          }}
        />
      </CardContent>
    </Card>
  );
}
