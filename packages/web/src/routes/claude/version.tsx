import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Loader2, RefreshCw, Download, AlertTriangle, Package, BookOpen } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

interface VersionPayload {
  installed: boolean;
  current: string;
  latest: string;
  canUpgrade: boolean;
  upgradeTarget: string;
  checkError?: string;
  operation?: { running: boolean; action?: string; startedAt?: string };
}

type State = 'loading' | 'error' | 'running' | 'not-installed' | 'upgradable' | 'up-to-date';

export function ClaudeVersion() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error, isFetching } = useQuery<VersionPayload>({
    queryKey: ['claude', 'version'],
    queryFn: () => apiGet<VersionPayload>('/api/claude/version'),
    refetchInterval: 5000,
  });

  const upgrade = useMutation({
    mutationFn: () => apiPost('/api/claude/upgrade'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claude', 'version'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const installed = !!data?.installed;
  const opRunning = !!data?.operation?.running;
  const canUpgrade = !!data?.canUpgrade;

  const state: State = error
    ? 'error'
    : isLoading
    ? 'loading'
    : opRunning
    ? 'running'
    : !installed
    ? 'not-installed'
    : canUpgrade
    ? 'upgradable'
    : 'up-to-date';

  const opAction = data?.operation?.action;
  const actionLabel = opRunning
    ? opAction === 'install'
      ? 'Installing...'
      : 'Upgrading...'
    : installed
    ? 'Upgrade'
    : 'Install';
  const actionDisabled = opRunning || upgrade.isPending || (installed && !canUpgrade);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span>Claude Code</span>
        </CardTitle>
        <StatusBadge state={state} target={data?.upgradeTarget || data?.latest} action={opAction} />
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
          <Button
            onClick={() => upgrade.mutate()}
            disabled={actionDisabled}
            className="gap-1.5"
          >
            {opRunning || upgrade.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {actionLabel}
          </Button>
          <Button
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey: ['claude', 'version'] })}
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

function StatusBadge({ state, target, action }: { state: State; target?: string; action?: string }) {
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
    case 'running':
      return (
        <Badge className="gap-1.5 bg-primary/15 font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-primary/20">
          <Loader2 className="h-3 w-3 animate-spin" />
          {action ? action.charAt(0).toUpperCase() + action.slice(1) : 'Running'}
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

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-muted px-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function renderMarkdown(content: string): ReactNode[] {
  const lines = content.split('\n');
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems.slice();
    nodes.push(
      <ul key={key++} className="my-1 list-inside list-disc space-y-0.5 pl-2 text-xs text-muted-foreground">
        {items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
      </ul>,
    );
    listItems = [];
  };

  for (const line of lines) {
    if (line.startsWith('### ')) {
      flushList();
      nodes.push(
        <h3 key={key++} className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70">
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith('## ')) {
      flushList();
      nodes.push(
        <h2 key={key++} className="mt-5 border-b border-border/40 pb-1 text-sm font-semibold first:mt-0">
          {renderInline(line.slice(3))}
        </h2>,
      );
    } else if (line.startsWith('# ')) {
      flushList();
      // top-level heading — skip, the card title already labels this panel
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      listItems.push(line.slice(2));
    } else if (line.trim() !== '') {
      flushList();
      nodes.push(
        <p key={key++} className="text-xs text-muted-foreground">
          {renderInline(line)}
        </p>,
      );
    } else {
      flushList();
    }
  }
  flushList();
  return nodes;
}

export function ChangelogPanel() {
  const { data, isLoading, error } = useQuery<{ content: string }>({
    queryKey: ['claude', 'changelog'],
    queryFn: () => apiGet<{ content: string }>('/api/claude/changelog'),
    staleTime: 60 * 60 * 1000,
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center gap-2 border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span>Changelog</span>
        </CardTitle>
        <a
          href="https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md"
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
            Loading changelog…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{(error as Error).message}</span>
          </div>
        )}
        {data?.content && (
          <div className="max-h-[480px] overflow-y-auto pr-1">
            {renderMarkdown(data.content)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
