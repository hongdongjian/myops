import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Loader2, RefreshCw, Download, AlertTriangle, Package, BookOpen } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { renderMarkdown } from '@/lib/render-markdown';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

interface CodexVersionPayload {
  installed: boolean;
  current: string;
  latest: string;
  canUpgrade: boolean;
  upgradeTarget: string;
  checkError?: string;
}

type State = 'loading' | 'error' | 'not-installed' | 'upgradable' | 'up-to-date';

export function CodexVersion() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error, isFetching } = useQuery<CodexVersionPayload>({
    queryKey: ['codex', 'version'],
    queryFn: () => apiGet<CodexVersionPayload>('/api/codex/version'),
    refetchInterval: 5000,
  });

  const upgrade = useMutation({
    mutationFn: () => apiPost('/api/codex/upgrade'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['codex', 'version'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const installed = !!data?.installed;
  const canUpgrade = !!data?.canUpgrade;

  const state: State = error
    ? 'error'
    : isLoading
    ? 'loading'
    : !installed
    ? 'not-installed'
    : canUpgrade
    ? 'upgradable'
    : 'up-to-date';

  const actionLabel = upgrade.isPending
    ? installed ? 'Upgrading...' : 'Installing...'
    : installed ? 'Upgrade' : 'Install';
  const actionDisabled = upgrade.isPending || (installed && !canUpgrade);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span>Codex</span>
        </CardTitle>
        <VersionStatusBadge state={state} target={data?.upgradeTarget || data?.latest} />
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
            {upgrade.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {actionLabel}
          </Button>
          <Button
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey: ['codex', 'version'] })}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            Check
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function VersionStatusBadge({ state, target }: { state: State; target?: string }) {
  switch (state) {
    case 'loading':
      return (
        <Badge variant="secondary" className="gap-1.5 font-mono text-[10px] uppercase tracking-wider">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading
        </Badge>
      );
    case 'error':
      return (
        <Badge className="gap-1.5 bg-destructive/15 font-mono text-[10px] uppercase tracking-wider text-destructive hover:bg-destructive/20">
          <AlertTriangle className="h-3 w-3" />
          Error
        </Badge>
      );
    case 'not-installed':
      return (
        <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wider">
          Not installed
        </Badge>
      );
    case 'upgradable':
      return (
        <Badge className="gap-1.5 bg-amber-500/15 font-mono text-[10px] uppercase tracking-wider text-amber-600 hover:bg-amber-500/20 dark:text-amber-400">
          <ArrowRight className="h-3 w-3" />
          {target ? `${target} available` : 'Update available'}
        </Badge>
      );
    case 'up-to-date':
      return (
        <Badge className="gap-1.5 bg-green-500/15 font-mono text-[10px] uppercase tracking-wider text-green-600 hover:bg-green-500/20 dark:text-green-400">
          <CheckCircle2 className="h-3 w-3" />
          Up to date
        </Badge>
      );
  }
}

function VersionDisplay({
  current,
  latest,
  state,
}: {
  current: string | null | undefined;
  latest: string | undefined;
  state: State;
}) {
  const showArrow = state === 'upgradable';
  return (
    <div
      className={cn(
        'grid items-end gap-6 rounded-lg border border-border/60 bg-muted/20 p-5',
        'sm:grid-cols-[1fr_auto_1fr]',
      )}
    >
      <VersionColumn
        label="Installed"
        value={current || (state === 'not-installed' ? null : current)}
        emphasis
        muted={!current}
      />
      <div className="hidden items-center justify-center sm:flex">
        <ArrowRight
          className={cn(
            'h-5 w-5 transition-colors',
            showArrow ? 'text-amber-500' : 'text-muted-foreground/30',
          )}
        />
      </div>
      <VersionColumn label="Latest" value={latest} emphasis={showArrow} />
    </div>
  );
}

function VersionColumn({
  label,
  value,
  emphasis,
  muted,
}: {
  label: string;
  value: string | null | undefined;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/80">
        {label}
      </div>
      <div
        className={cn(
          'font-mono tabular-nums',
          emphasis ? 'text-2xl font-semibold' : 'text-xl',
          muted ? 'text-muted-foreground/60' : 'text-foreground',
        )}
      >
        {value || <span className="text-muted-foreground/40">—</span>}
      </div>
    </div>
  );
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
}

export function CodexChangelogPanel() {
  const { data, isLoading, error } = useQuery<{ releases: GitHubRelease[] }>({
    queryKey: ['codex', 'changelog'],
    queryFn: () => apiGet<{ releases: GitHubRelease[] }>('/api/codex/changelog'),
    staleTime: 60 * 60 * 1000,
  });

  const releases = data?.releases ?? [];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center gap-2 border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span>Releases</span>
        </CardTitle>
        <a
          href="https://github.com/openai/codex/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto font-mono text-[10px] text-muted-foreground/60 hover:text-muted-foreground"
        >
          github ↗
        </a>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading && (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading releases…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{(error as Error).message}</span>
          </div>
        )}
        {releases.length > 0 && (
          <div className="max-h-[480px] overflow-y-auto space-y-5 pr-1">
            {releases.map((r) => (
              <div key={r.tag_name} className="space-y-1.5">
                <div className="flex items-baseline gap-2">
                  <a
                    href={r.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm font-semibold hover:underline"
                  >
                    {r.tag_name}
                  </a>
                  {r.name && r.name !== r.tag_name ? (
                    <span className="text-xs text-muted-foreground">{r.name}</span>
                  ) : null}
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                    {r.published_at ? new Date(r.published_at).toLocaleDateString() : ''}
                  </span>
                </div>
                {r.body ? (
                  <div className="space-y-1">{renderMarkdown(r.body.trim())}</div>
                ) : null}
                <div className="border-b border-border/40" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
