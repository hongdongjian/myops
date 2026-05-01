import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Loader2, RefreshCw, Download, AlertTriangle, Package, BookOpen, Cpu } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { renderMarkdown } from '@/lib/render-markdown';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';
import type { UsageStatus } from './types';

interface VersionPayload {
  installed: boolean;
  current: string;
  latest: string;
  canUpgrade: boolean;
  upgradeTarget: string;
  checkError?: string;
}

interface UsageEnvelopeData {
  unlimited?: boolean;
  used?: number;
  total?: number;
  remaining?: number;
  percentUsed?: number;
}

interface GithubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
}

type State = 'loading' | 'error' | 'upgrading' | 'not-installed' | 'upgradable' | 'up-to-date';

const fmtNum = (v: unknown): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '--';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

export function CopilotVersion() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error, isFetching } = useQuery<VersionPayload>({
    queryKey: ['copilot', 'version'],
    queryFn: () => apiGet<VersionPayload>('/api/copilot/version'),
    refetchInterval: 5000,
  });
  const { data: usage, refetch: refetchUsage } = useQuery<UsageEnvelopeData | UsageStatus>({
    queryKey: ['copilot', 'usage'],
    queryFn: () => apiGet<UsageEnvelopeData>('/api/copilot/usage'),
    refetchInterval: 600000,
  });

  const upgrade = useMutation({
    mutationFn: () => apiPost('/api/copilot/upgrade'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot', 'version'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const installed = !!data?.installed;
  const canUpgrade = !!data?.canUpgrade;

  const state: State = error
    ? 'error'
    : isLoading
    ? 'loading'
    : upgrade.isPending
    ? 'upgrading'
    : !installed
    ? 'not-installed'
    : canUpgrade
    ? 'upgradable'
    : 'up-to-date';

  const actionLabel = upgrade.isPending ? 'Upgrading...' : installed ? 'Upgrade' : 'Install';
  const actionDisabled = upgrade.isPending || (installed && !canUpgrade);

  const usageData = (usage ?? {}) as UsageEnvelopeData;
  const unlimited = !!usageData.unlimited;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border/60 pb-4">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span>copilot-api</span>
          </CardTitle>
          <StatusBadge state={state} target={data?.upgradeTarget || data?.latest} />
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <VersionDisplay
            current={installed ? data?.current : null}
            latest={data?.latest}
            state={state}
          />

          {data?.checkError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="font-mono">{data.checkError}</span>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="font-mono">{(error as Error).message}</span>
            </div>
          ) : null}

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={() => upgrade.mutate()} disabled={actionDisabled} className="gap-1.5">
              {upgrade.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {actionLabel}
            </Button>
            <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ['copilot', 'version'] })} disabled={isFetching} className="gap-1.5">
              <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
              Check
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Usage</span>
            <Button size="sm" variant="outline" onClick={() => refetchUsage()}>Refresh</Button>
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
                  {Number.isFinite(Number(usageData.percentUsed)) ? `${Number(usageData.percentUsed).toFixed(2)}%` : '--'}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.max(0, Number(usageData.percentUsed) || 0))}%` }} />
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

      <ModelsPanel />
      <ReleasesPanel />
    </div>
  );
}

function StatusBadge({ state, target }: { state: State; target?: string }) {
  switch (state) {
    case 'loading':
      return <Badge variant="secondary" className="gap-1.5 font-mono text-[10px] uppercase tracking-wider"><Loader2 className="h-3 w-3 animate-spin" />Loading</Badge>;
    case 'error':
      return <Badge className="gap-1.5 bg-destructive/15 font-mono text-[10px] uppercase tracking-wider text-destructive hover:bg-destructive/20"><AlertTriangle className="h-3 w-3" />Error</Badge>;
    case 'upgrading':
      return <Badge className="gap-1.5 bg-primary/15 font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-primary/20"><Loader2 className="h-3 w-3 animate-spin" />Upgrading</Badge>;
    case 'not-installed':
      return <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wider">Not installed</Badge>;
    case 'upgradable':
      return (
        <Badge className="gap-1.5 bg-amber-500/15 font-mono text-[10px] uppercase tracking-wider text-amber-600 hover:bg-amber-500/20 dark:text-amber-400">
          <ArrowRight className="h-3 w-3" />
          {target ? `${target} available` : 'Update available'}
        </Badge>
      );
    case 'up-to-date':
      return <Badge className="gap-1.5 bg-green-500/15 font-mono text-[10px] uppercase tracking-wider text-green-600 hover:bg-green-500/20 dark:text-green-400"><CheckCircle2 className="h-3 w-3" />Up to date</Badge>;
  }
}

function VersionDisplay({ current, latest, state }: { current: string | null | undefined; latest: string | undefined; state: State }) {
  const showArrow = state === 'upgradable';
  return (
    <div className={cn('grid items-end gap-6 rounded-lg border border-border/60 bg-muted/20 p-5', 'sm:grid-cols-[1fr_auto_1fr]')}>
      <VersionColumn label="Installed" value={current || (state === 'not-installed' ? null : current)} emphasis muted={!current} />
      <div className="hidden items-center justify-center sm:flex">
        <ArrowRight className={cn('h-5 w-5 transition-colors', showArrow ? 'text-amber-500' : 'text-muted-foreground/30')} />
      </div>
      <VersionColumn label="Latest" value={latest} emphasis={showArrow} />
    </div>
  );
}

function VersionColumn({ label, value, emphasis, muted }: { label: string; value: string | null | undefined; emphasis?: boolean; muted?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/80">{label}</div>
      <div className={cn('font-mono tabular-nums', emphasis ? 'text-2xl font-semibold' : 'text-xl', muted ? 'text-muted-foreground/60' : 'text-foreground')}>
        {value || <span className="text-muted-foreground/40">—</span>}
      </div>
    </div>
  );
}

interface ModelEntry {
  id: string;
  name?: string;
  billing?: { multiplier?: number };
  capabilities?: { limits?: { max_context_window_tokens?: number } };
  [key: string]: unknown;
}

type ModelCategory = 'Claude' | 'GPT' | 'Gemini' | 'Grok' | 'Other';

function getCategory(id: string): ModelCategory {
  const l = id.toLowerCase();
  if (l.startsWith('claude')) return 'Claude';
  if (l.startsWith('gpt')) return 'GPT';
  if (l.startsWith('gemini')) return 'Gemini';
  if (l.startsWith('grok')) return 'Grok';
  return 'Other';
}

const CLAUDE_TIER_ORDER: Record<string, number> = { opus: 0, sonnet: 1, haiku: 2 };

function sortModels(a: ModelEntry, b: ModelEntry): number {
  const catA = getCategory(a.id);
  const catB = getCategory(b.id);
  if (catA !== catB) return 0;
  if (catA === 'Claude') {
    const tierA = Object.entries(CLAUDE_TIER_ORDER).find(([k]) => a.id.toLowerCase().includes(k));
    const tierB = Object.entries(CLAUDE_TIER_ORDER).find(([k]) => b.id.toLowerCase().includes(k));
    const ta = tierA ? tierA[1] : 9;
    const tb = tierB ? tierB[1] : 9;
    if (ta !== tb) return ta - tb;
  }
  return b.id.localeCompare(a.id);
}

const CATEGORY_ORDER: ModelCategory[] = ['Claude', 'GPT', 'Gemini', 'Grok', 'Other'];

function ModelsPanel() {
  const { data, isLoading, error } = useQuery<ModelEntry[]>({
    queryKey: ['copilot', 'models'],
    queryFn: () => apiGet<ModelEntry[]>('/api/copilot/models'),
    staleTime: 60 * 1000,
    retry: false,
  });

  if (!isLoading && !data && !error) return null;

  const grouped = (data ?? []).reduce<Record<ModelCategory, ModelEntry[]>>(
    (acc, m) => {
      const cat = getCategory(m.id);
      acc[cat].push(m);
      return acc;
    },
    { Claude: [], GPT: [], Gemini: [], Grok: [], Other: [] },
  );
  CATEGORY_ORDER.forEach((cat) => grouped[cat].sort(sortModels));
  const activeCategories = CATEGORY_ORDER.filter((c) => grouped[c].length > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <span>Models</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading && (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading models…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{(error as Error).message}</span>
          </div>
        )}
        {data && data.length > 0 && (
          <div className="space-y-4">
            {activeCategories.map((cat) => (
              <div key={cat}>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70">{cat}</div>
                <div className="flex flex-wrap gap-2">
                  {grouped[cat].map((m) => {
                    const multiplier = m.billing?.multiplier;
                    const ctxK = m.capabilities?.limits?.max_context_window_tokens;
                    return (
                      <div
                        key={m.id}
                        className="flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-3 py-1 text-xs"
                      >
                        <span className="font-mono font-medium">{m.id}</span>
                        {multiplier !== undefined ? (
                          <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-[10px]">
                            ×{multiplier}
                          </Badge>
                        ) : null}
                        {ctxK !== undefined ? (
                          <span className="text-muted-foreground">
                            {(ctxK / 1000).toFixed(0)}k
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {data && data.length === 0 && (
          <div className="text-xs text-muted-foreground">No models returned.</div>
        )}
      </CardContent>
    </Card>
  );
}

function ReleasesPanel() {
  const { data, isLoading, error } = useQuery<GithubRelease[]>({
    queryKey: ['copilot', 'releases'],
    queryFn: () => apiGet<GithubRelease[]>('/api/copilot/releases'),
    staleTime: 60 * 60 * 1000,
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center gap-2 border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span>Releases</span>
        </CardTitle>
        <a href="https://github.com/caozhiyuan/copilot-api/releases" target="_blank" rel="noopener noreferrer" className="ml-auto font-mono text-[10px] text-muted-foreground/60 hover:text-muted-foreground">
          github ↗
        </a>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading && (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading releases…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{(error as Error).message}</span>
          </div>
        )}
        {data && data.length > 0 && (
          <div className="max-h-[480px] overflow-y-auto pr-1 space-y-4">
            {data.map((release) => (
              <div key={release.tag_name} className="space-y-1.5 border-b border-border/40 pb-4 last:border-0 last:pb-0">
                <div className="flex items-baseline gap-2">
                  <a href={release.html_url} target="_blank" rel="noopener noreferrer" className="font-mono text-sm font-semibold hover:underline">
                    {release.name || release.tag_name}
                  </a>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                    {new Date(release.published_at).toLocaleDateString()}
                  </span>
                </div>
                {release.body ? <div className="space-y-1">{renderMarkdown(release.body.trim())}</div> : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
