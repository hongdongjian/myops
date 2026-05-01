import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/toast';
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
  onApply: (id: string) => void;
  onDelete: (id: string) => void;
  onRemark: (id: string, remark: string) => void;
  pending: boolean;
}

function AccountRow({ account, onApply, onDelete, onRemark, pending }: AccountRowProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [remark, setRemark] = useState(account.remark ?? '');

  useEffect(() => {
    if (!editOpen) setRemark(account.remark ?? '');
  }, [account.remark, editOpen]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2 font-medium">
          <span className="font-mono text-sm">{account.login || account.id}</span>
          {account.current ? <Badge className="bg-green-600 text-white">Active</Badge> : null}
          {account.tokenPreview ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{account.tokenPreview}</span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          First cached: {formatTime(account.createdAt)} · Last active: {formatTime(account.lastUsedAt)}
        </div>
        {account.remark ? (
          <div className="text-xs text-muted-foreground">Remark: {account.remark}</div>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={account.current ? 'outline' : 'default'}
          onClick={() => onApply(account.id)}
          disabled={account.current || pending}
        >
          Apply
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (window.confirm(`Delete account ${account.login || account.id}?`)) onDelete(account.id);
          }}
          disabled={pending}
        >
          Delete
        </Button>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Login</Label>
              <Input value={account.login || account.id} disabled />
            </div>
            <div className="space-y-1.5">
              <Label>Remark</Label>
              <Input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Optional note (e.g. work, personal)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={() => { onRemark(account.id, remark); setEditOpen(false); }} disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
          setError(r.error || 'OAuth not completed');
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
          <DialogTitle>GitHub OAuth Login</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {!loginId ? (
            <Button onClick={() => startMut.mutate()} disabled={startMut.isPending}>
              {startMut.isPending ? 'Starting...' : 'Start Login'}
            </Button>
          ) : statusInfo?.status === 'completed' ? (
            <div className="text-green-600">Login completed: {statusInfo.account?.login || ''}</div>
          ) : (
            <div className="space-y-2">
              <div>
                <span className="text-muted-foreground">Code: </span>
                <span className="font-mono text-base font-semibold">{statusInfo?.code || 'Waiting...'}</span>
              </div>
              {statusInfo?.verificationUrl ? (
                <div>
                  <span className="text-muted-foreground">URL: </span>
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
              <div className="text-xs text-muted-foreground">
                {statusInfo?.clipboardCopied ? <span>Copied to clipboard · </span> : null}
                {statusInfo?.browserOpened ? <span>Browser opened</span> : null}
              </div>
            </div>
          )}
          {error ? <div className="text-xs text-destructive">{error}</div> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CopilotAccounts() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery<CopilotAccountsPayload>({
    queryKey: ['copilot', 'accounts'],
    queryFn: () => apiGet<CopilotAccountsPayload>('/api/copilot/accounts'),
  });

  const switchMut = useMutation({
    mutationFn: (accountId: string) =>
      apiPost('/api/copilot/accounts/switch', { accountId }),
    onSuccess: () => {
      toast.success('Account applied');
      qc.invalidateQueries({ queryKey: ['copilot'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (accountId: string) =>
      apiPost('/api/copilot/accounts/delete', { accountId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot', 'accounts'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const remarkMut = useMutation({
    mutationFn: ({ accountId, remark }: { accountId: string; remark: string }) =>
      apiPost('/api/copilot/accounts/remark/save', { accountId, remark }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot', 'accounts'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const [oauthOpen, setOauthOpen] = useState(false);
  const accounts = data?.accounts ?? [];
  const pending = switchMut.isPending || deleteMut.isPending || remarkMut.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>GitHub Accounts</span>
          <Button size="sm" onClick={() => setOauthOpen(true)}>+ Add Account</Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading...</div>
        ) : accounts.length === 0 ? (
          <div className="text-xs text-muted-foreground">No cached accounts. Click "+ Add Account" to add one via OAuth.</div>
        ) : (
          accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              pending={pending}
              onApply={(id) => switchMut.mutate(id)}
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
