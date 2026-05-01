import { useEffect, useState } from 'react';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
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
  DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

interface CodexProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface CodexStoredQuota {
  hourlyPercentage: number;
  hourlyResetTime?: number;
  hourlyWindowMinutes?: number;
  hourlyWindowPresent: boolean;
  weeklyPercentage: number;
  weeklyResetTime?: number;
  weeklyWindowMinutes?: number;
  weeklyWindowPresent: boolean;
  codeReviewPercentage?: number;
  codeReviewResetTime?: number;
  codeReviewLabel?: string;
  codeReviewPresent: boolean;
}

interface CodexAccountView {
  id: string;
  email: string;
  remark?: string;
  model?: string;
  planType?: string;
  accountName?: string;
  workspaceTitle?: string;
  quota?: CodexStoredQuota;
  quotaError?: { message: string };
  quotaUpdatedAt?: number;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

interface ProvidersPayload {
  providers: CodexProvider[];
  accounts: CodexAccountView[];
  activeProvider: string;
  authMode: boolean;
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
  account?: { id?: string; email?: string };
}

interface ImportLocalPayload {
  importedAccount?: { id?: string; email?: string };
}

type ProviderType = 'api-key' | 'login';

interface EditingState {
  original: string | null;
  form: CodexProvider;
  type: ProviderType;
}

const BASE_URL_PRESETS = [
  { label: 'DeepSeek', value: 'https://api.deepseek.com' },
  { label: 'GLM', value: 'https://open.bigmodel.cn/api/coding/paas/v4' },
  { label: 'Local', value: 'http://localhost:4141' },
];

const empty: CodexProvider = { name: '', baseUrl: '', apiKey: '', model: '' };

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

function formatDateTime(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

interface QuotaBarProps {
  label: string;
  percentage: number;
  resetTime?: number;
  windowMinutes?: number;
}

function QuotaBar({ label, percentage, resetTime, windowMinutes }: QuotaBarProps) {
  const pct = Math.max(0, Math.min(100, percentage));
  const resetTimeMs = resetTime ? resetTime * 1000 : null;
  const remaining = resetTimeMs && resetTimeMs > Date.now() ? resetTimeMs - Date.now() : null;
  const windowLabel = windowMinutes
    ? windowMinutes >= 60 * 24 * 7
      ? 'Weekly'
      : windowMinutes >= 60
        ? `${Math.round(windowMinutes / 60)}h`
        : `${windowMinutes}m`
    : label;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{windowLabel}</span>
        <span className={cn('font-medium', pct >= 90 ? 'text-green-500' : pct >= 50 ? 'text-yellow-500' : 'text-red-500')}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', pct >= 90 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      {remaining !== null && resetTimeMs ? (
        <div className="text-xs text-muted-foreground">
          {formatDuration(remaining)} ({formatDateTime(resetTimeMs)})
        </div>
      ) : null}
    </div>
  );
}

interface QuotaSectionProps {
  quota: CodexStoredQuota;
  quotaUpdatedAt?: number;
  quotaError?: { message: string };
  onRefresh: () => void;
  refreshing: boolean;
}

function QuotaSection({ quota, quotaUpdatedAt, quotaError, onRefresh, refreshing }: QuotaSectionProps) {
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border/50 bg-muted/30 p-2">
      {quota.hourlyWindowPresent ? (
        <QuotaBar
          label="Hourly"
          percentage={quota.hourlyPercentage}
          resetTime={quota.hourlyResetTime}
          windowMinutes={quota.hourlyWindowMinutes}
        />
      ) : null}
      {quota.weeklyWindowPresent ? (
        <QuotaBar
          label="Weekly"
          percentage={quota.weeklyPercentage}
          resetTime={quota.weeklyResetTime}
          windowMinutes={quota.weeklyWindowMinutes}
        />
      ) : null}
      {quota.codeReviewPresent && quota.codeReviewPercentage !== undefined ? (
        <QuotaBar
          label={quota.codeReviewLabel || 'Code Review'}
          percentage={quota.codeReviewPercentage}
          resetTime={quota.codeReviewResetTime}
        />
      ) : null}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {quotaUpdatedAt ? <span>配额刷新: {formatDateTime(quotaUpdatedAt)}</span> : <span />}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-1 hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
          <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>
      {quotaError ? <div className="text-xs text-destructive">{quotaError.message}</div> : null}
    </div>
  );
}

function BaseUrlField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {BASE_URL_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => onChange(preset.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium border transition-all duration-150',
              value === preset.value
                ? 'border-primary bg-primary/10 text-primary shadow-sm'
                : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/70',
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <Input
        value={value}
        placeholder="Or enter a custom URL..."
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function TypeToggle({ value, onChange }: { value: ProviderType; onChange: (v: ProviderType) => void }) {
  return (
    <div className="flex gap-1 rounded-md border border-border p-0.5 bg-muted/40 w-fit">
      {(['api-key', 'login'] as ProviderType[]).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cn(
            'rounded px-3 py-1 text-xs font-medium transition-all duration-150',
            value === t
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t === 'api-key' ? 'API Key' : 'Login Auth'}
        </button>
      ))}
    </div>
  );
}

interface LoginAuthFormProps {
  onCompleted: () => void;
  onCancel: () => void;
}

function LoginAuthForm({ onCompleted, onCancel }: LoginAuthFormProps) {
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [loginId, setLoginId] = useState('');
  const [info, setInfo] = useState<OAuthStatusResponse | null>(null);
  const [error, setError] = useState('');

  const saveEdit = async (accountId: string) => {
    if (name.trim() || model.trim()) {
      await apiPost('/api/codex/accounts/edit', { accountId, remark: name.trim(), model: model.trim() });
    }
  };

  useEffect(() => {
    if (!loginId) return;
    let cancelled = false;
    let timer = 0 as unknown as ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await apiGet<OAuthStatusResponse>(
          `/api/codex/accounts/oauth/status?loginId=${encodeURIComponent(loginId)}`,
        );
        if (cancelled) return;
        setInfo(r);
        if (r.status === 'completed') {
          if (r.account?.id) await saveEdit(r.account.id).catch(() => {});
          onCompleted();
          return;
        }
        if (r.status === 'error' || r.status === 'timeout') { setError(r.error || 'OAuth not completed'); return; }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
        return;
      }
      if (!cancelled) timer = setTimeout(tick, 2000);
    };
    timer = setTimeout(tick, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginId]);

  const cancelOAuth = useMutation({
    mutationFn: () => apiPost('/api/codex/accounts/oauth/cancel', { loginId }),
    onSettled: () => onCancel(),
  });

  const startOAuth = useMutation({
    mutationFn: () => apiPost<OAuthStartResponse>('/api/codex/accounts/oauth/start'),
    onSuccess: (r) => {
      setLoginId(r.loginId);
      setError('');
      if (r.authUrl) window.open(r.authUrl, '_blank', 'noreferrer');
    },
    onError: (e: Error) => setError(e.message),
  });

  const importLocal = useMutation({
    mutationFn: () => apiPost<ImportLocalPayload>('/api/codex/accounts/import-local'),
    onSuccess: async (r) => {
      const accountId = r?.importedAccount?.id;
      if (accountId) await saveEdit(accountId).catch(() => {});
      onCompleted();
    },
    onError: (e: Error) => setError(e.message),
  });

  const busy = startOAuth.isPending || importLocal.isPending || cancelOAuth.isPending;
  const canProceed = name.trim() !== '' && model.trim() !== '';

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Name</Label>
        <Input
          value={name}
          placeholder="e.g. My Account"
          onChange={(e) => setName(e.target.value)}
          disabled={!!loginId}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Model</Label>
        <Input
          value={model}
          placeholder="e.g. o3, codex-mini-latest"
          onChange={(e) => setModel(e.target.value)}
          disabled={!!loginId}
        />
      </div>

      {!loginId ? (
        <div className="flex gap-2">
          <Button onClick={() => startOAuth.mutate()} disabled={busy || !canProceed}>
            {startOAuth.isPending ? 'Starting...' : 'Start Login'}
          </Button>
          <Button variant="outline" onClick={() => importLocal.mutate()} disabled={busy || !canProceed}>
            {importLocal.isPending ? 'Importing...' : 'Import local auth'}
          </Button>
        </div>
      ) : info?.status === 'completed' ? (
        <div className="text-green-500 text-xs">Login completed: {info.account?.email || ''}</div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Status: {info?.status || 'Waiting...'}</div>
          {info?.authUrl ? (
            <a href={info.authUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline break-all">
              {info.authUrl}
            </a>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => cancelOAuth.mutate()} disabled={busy}>
            Cancel Login
          </Button>
        </div>
      )}

      {error ? <div className="text-destructive text-xs">{error}</div> : null}
    </div>
  );
}

export function CodexProviders() {
  const qc = useQueryClient();
  const toast = useToast();

  const { data, isLoading: provLoading, error: provError } = useQuery<ProvidersPayload>({
    queryKey: ['codex', 'providers'],
    queryFn: () => apiGet<ProvidersPayload>('/api/codex/providers'),
  });

  const [editing, setEditing] = useState<EditingState | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [editingAccount, setEditingAccount] = useState<{ id: string; remark: string; model: string } | null>(null);

  const closeDialog = () => { setEditing(null); setShowApiKey(false); };

  const addProv = useMutation({
    mutationFn: (p: CodexProvider) => apiPost('/api/codex/providers/add', p),
    onSuccess: () => { closeDialog(); toast.success('Added'); qc.invalidateQueries({ queryKey: ['codex', 'providers'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateProv = useMutation({
    mutationFn: ({ original, p }: { original: string; p: CodexProvider }) =>
      apiPost('/api/codex/providers/update', { name: original, newName: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model }),
    onSuccess: () => { closeDialog(); toast.success('Updated'); qc.invalidateQueries({ queryKey: ['codex', 'providers'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delProv = useMutation({
    mutationFn: (name: string) => apiPost('/api/codex/providers/delete', { name }),
    onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['codex', 'providers'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const applyProv = useMutation({
    mutationFn: (name: string) => apiPost('/api/codex/providers/apply', { name }),
    onSuccess: () => { toast.success('Applied'); qc.invalidateQueries({ queryKey: ['codex'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const applyAcc = useMutation({
    mutationFn: (accountId: string) => apiPost('/api/codex/accounts/apply', { accountId }),
    onSuccess: () => { toast.success('Applied'); qc.invalidateQueries({ queryKey: ['codex'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delAcc = useMutation({
    mutationFn: (accountId: string) => apiPost('/api/codex/accounts/delete', { accountId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['codex', 'providers'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const editAcc = useMutation({
    mutationFn: (form: { id: string; remark: string; model: string }) =>
      apiPost('/api/codex/accounts/edit', { accountId: form.id, remark: form.remark, model: form.model }),
    onSuccess: () => {
      setEditingAccount(null);
      toast.success('Updated');
      qc.invalidateQueries({ queryKey: ['codex', 'providers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refreshQuota = async (accountId: string) => {
    setRefreshingIds((s) => new Set([...s, accountId]));
    try {
      const updated = await apiGet<CodexAccountView>(`/api/codex/accounts/quota?accountId=${encodeURIComponent(accountId)}`);
      qc.setQueryData<ProvidersPayload>(['codex', 'providers'], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          accounts: prev.accounts.map((a) => (a.id === accountId ? { ...a, ...updated } : a)),
        };
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshingIds((s) => { const n = new Set(s); n.delete(accountId); return n; });
    }
  };

  // Auto-fetch quota for current active account on first load
  useEffect(() => {
    if (!data) return;
    const active = data.accounts.find((a) => a.current);
    if (active && !active.quotaUpdatedAt) {
      void refreshQuota(active.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.accounts.length]);

  const handleSubmit = () => {
    if (!editing) return;
    if (!editing.form.name.trim()) { toast.error('name is required'); return; }
    if (editing.original) {
      updateProv.mutate({ original: editing.original, p: editing.form });
    } else {
      addProv.mutate(editing.form);
    }
  };

  const isAdding = editing !== null && editing.original === null;
  const providers = data?.providers ?? [];
  const accounts = data?.accounts ?? [];
  const hasItems = providers.length > 0 || accounts.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Providers</span>
          <Button size="sm" onClick={() => setEditing({ original: null, form: { ...empty }, type: 'api-key' })}>
            + Add Provider
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {provError ? <div className="text-xs text-destructive">{(provError as Error).message}</div> : null}
        {provLoading && !data ? <div className="text-xs text-muted-foreground">Loading...</div> : null}

        {providers.map((p) => {
          const active = !data?.authMode && data?.activeProvider === p.name;
          return (
            <div key={`prov-${p.name}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 font-medium text-sm">
                  {p.name}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">API Key</span>
                  {active ? <Badge className="bg-green-600 text-white">Active</Badge> : null}
                </div>
                <div className="text-xs text-muted-foreground">base: <code>{p.baseUrl || '--'}</code></div>
                {p.model ? <div className="text-xs text-muted-foreground">model: <code>{p.model}</code></div> : null}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant={active ? 'outline' : 'default'} onClick={() => applyProv.mutate(p.name)} disabled={active || applyProv.isPending}>Apply</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing({ original: p.name, form: { ...p }, type: 'api-key' })}>Edit</Button>
                <Button size="sm" variant="outline"
                  onClick={() => { if (window.confirm(`Delete provider ${p.name}?`)) delProv.mutate(p.name); }}
                  disabled={delProv.isPending}>
                  Delete
                </Button>
              </div>
            </div>
          );
        })}

        {accounts.map((a) => {
          const active = !!data?.authMode && a.current;
          const label = a.remark || a.email || a.id;
          const isRefreshing = refreshingIds.has(a.id);
          return (
            <div key={`acc-${a.id}`} className="rounded border border-border p-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <span className="font-mono">{label}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Login Auth</span>
                    {active ? <Badge className="bg-green-600 text-white">Active</Badge> : null}
                    {a.planType ? <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{a.planType}</span> : null}
                  </div>
                  {a.remark && a.email ? (
                    <div className="text-xs text-muted-foreground font-mono">{a.email}</div>
                  ) : null}
                  {a.model ? <div className="text-xs text-muted-foreground">model: <code>{a.model}</code></div> : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={a.current && !!data?.authMode ? 'outline' : 'default'}
                    onClick={() => applyAcc.mutate(a.id)}
                    disabled={(a.current && !!data?.authMode) || applyAcc.isPending}
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingAccount({ id: a.id, remark: a.remark ?? '', model: a.model ?? '' })}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="outline"
                    onClick={() => { if (window.confirm(`Delete account ${a.email || a.id}?`)) delAcc.mutate(a.id); }}
                    disabled={delAcc.isPending}>
                    Delete
                  </Button>
                </div>
              </div>
              {a.quota ? (
                <QuotaSection
                  quota={a.quota}
                  quotaUpdatedAt={a.quotaUpdatedAt}
                  quotaError={a.quotaError}
                  onRefresh={() => void refreshQuota(a.id)}
                  refreshing={isRefreshing}
                />
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  {a.quotaError ? (
                    <span className="text-xs text-destructive">{a.quotaError.message}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No quota data</span>
                  )}
                  <button
                    type="button"
                    onClick={() => void refreshQuota(a.id)}
                    disabled={isRefreshing}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={cn('h-3 w-3', isRefreshing && 'animate-spin')} />
                    {isRefreshing ? 'Fetching...' : 'Fetch quota'}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {!provLoading && !hasItems ? (
          <div className="text-xs text-muted-foreground">No providers. Add one to get started.</div>
        ) : null}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.original ? 'Edit Provider' : 'Add Provider'}</DialogTitle>
            {isAdding ? <DialogDescription className="sr-only">Choose provider type</DialogDescription> : null}
          </DialogHeader>
          {editing ? (
            <div className="grid gap-4">
              {isAdding ? (
                <TypeToggle value={editing.type} onChange={(t) => setEditing({ ...editing, type: t })} />
              ) : null}

              {editing.type === 'login' ? (
                <LoginAuthForm
                  onCompleted={() => { closeDialog(); qc.invalidateQueries({ queryKey: ['codex'] }); }}
                  onCancel={closeDialog}
                />
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                      value={editing.form.name}
                      onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Base URL</Label>
                    <BaseUrlField
                      value={editing.form.baseUrl}
                      onChange={(v) => setEditing({ ...editing, form: { ...editing.form, baseUrl: v } })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>API Key</Label>
                    <div className="relative">
                      <Input
                        type={showApiKey ? 'text' : 'password'}
                        value={editing.form.apiKey}
                        placeholder="sk-..."
                        className="pr-9"
                        onChange={(e) => setEditing({ ...editing, form: { ...editing.form, apiKey: e.target.value } })}
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Model</Label>
                    <Input
                      value={editing.form.model}
                      placeholder="e.g. gpt-4o"
                      onChange={(e) => setEditing({ ...editing, form: { ...editing.form, model: e.target.value } })}
                    />
                  </div>
                </>
              )}
            </div>
          ) : null}
          {editing?.type !== 'login' ? (
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={addProv.isPending || updateProv.isPending}>Save</Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingAccount} onOpenChange={(o) => { if (!o) setEditingAccount(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
            <DialogDescription className="sr-only">Edit account remark and model</DialogDescription>
          </DialogHeader>
          {editingAccount ? (
            <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label>Name / Remark</Label>
                <Input
                  value={editingAccount.remark}
                  placeholder="e.g. My Work Account"
                  onChange={(e) => setEditingAccount({ ...editingAccount, remark: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                <Input
                  value={editingAccount.model}
                  placeholder="e.g. o3, codex-mini-latest"
                  onChange={(e) => setEditingAccount({ ...editingAccount, model: e.target.value })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAccount(null)}>Cancel</Button>
            <Button
              onClick={() => { if (editingAccount) editAcc.mutate(editingAccount); }}
              disabled={editAcc.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
