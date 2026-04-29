import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

type Category = 'skills' | 'rules' | 'commands';

interface AssetEntry {
  name: string;
  isDir: boolean;
  isSymlink?: boolean;
  target?: string;
}

interface AssetListPayload {
  category: Category;
  home: AssetEntry[];
  project: AssetEntry[];
  homePath: string;
  projectPath: string;
}

interface ContentPayload {
  category: Category;
  source: 'home' | 'project';
  name: string;
  content: string;
}

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'skills', label: 'Skills' },
  { value: 'rules', label: 'Rules' },
  { value: 'commands', label: 'Commands' },
];

interface CategoryPanelProps {
  category: Category;
  label: string;
}

function CategoryPanel({ category, label }: CategoryPanelProps) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<AssetListPayload>({
    queryKey: ['assets', 'list', category],
    queryFn: () => apiGet<AssetListPayload>(`/api/assets/list?category=${category}`),
  });

  const [viewing, setViewing] = useState<ContentPayload | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [actionErr, setActionErr] = useState('');

  const sync = useMutation({
    mutationFn: () => apiPost('/api/assets/sync', { category }),
    onSuccess: () => {
      setActionMsg(`${label} 已同步`);
      setActionErr('');
      qc.invalidateQueries({ queryKey: ['assets', 'list', category] });
    },
    onError: (e: Error) => setActionErr(e.message),
  });
  const uninstall = useMutation({
    mutationFn: ({ name, removeProject }: { name: string; removeProject: boolean }) =>
      apiPost('/api/assets/uninstall', { category, name, removeProject }),
    onSuccess: () => {
      setActionMsg('已卸载');
      setActionErr('');
      qc.invalidateQueries({ queryKey: ['assets', 'list', category] });
    },
    onError: (e: Error) => setActionErr(e.message),
  });

  const view = async (source: 'home' | 'project', name: string) => {
    try {
      const res = await apiGet<ContentPayload>(
        `/api/assets/content?category=${category}&source=${source}&name=${encodeURIComponent(name)}`,
      );
      setViewing(res);
    } catch (e) {
      setViewing({ category, source, name, content: `加载失败: ${(e as Error).message}` });
    }
  };

  const renderEntries = (source: 'home' | 'project', entries: AssetEntry[]) =>
    entries.length === 0 ? (
      <div className="text-xs text-muted-foreground">空</div>
    ) : (
      <ul className="space-y-1">
        {entries.map((e) => (
          <li key={`${source}-${e.name}`} className="flex items-center justify-between rounded border border-border px-2 py-1 text-sm">
            <button onClick={() => view(source, e.name)} className="font-mono hover:underline text-left">
              {e.name}
              {e.isSymlink ? <span className="ml-1 text-xs text-muted-foreground">(symlink)</span> : null}
            </button>
            {source === 'home' ? (
              <Button size="sm" variant="outline"
                onClick={() => { if (window.confirm(`卸载 ${e.name}? (从 ~ 目录移除)`)) uninstall.mutate({ name: e.name, removeProject: false }); }}>
                卸载
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{label}</span>
          <Button size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? '同步中...' : '同步 ~ → 项目'}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <div className="text-xs text-destructive">{(error as Error).message}</div> : null}
        {isLoading ? <div className="text-xs text-muted-foreground">加载中...</div> : null}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">~ 用户目录</Badge>
              <code className="text-xs text-muted-foreground">{data?.homePath || ''}</code>
            </div>
            {renderEntries('home', data?.home ?? [])}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">项目</Badge>
              <code className="text-xs text-muted-foreground">{data?.projectPath || ''}</code>
            </div>
            {renderEntries('project', data?.project ?? [])}
          </div>
        </div>
        {actionMsg ? <div className="text-xs text-green-500">{actionMsg}</div> : null}
        {actionErr ? <div className="text-xs text-destructive">{actionErr}</div> : null}
      </CardContent>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{viewing ? `${viewing.source} / ${viewing.name}` : ''}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[60vh] rounded border border-border bg-muted/30">
            <pre className="p-3 font-mono text-xs whitespace-pre-wrap">{viewing?.content}</pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function Assets() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">资产</h1>
      <p className="text-sm text-muted-foreground">
        将用户目录 (~/.claude, ~/.codex) 下的 skills/rules/commands 同步到项目 conf/ 目录，便于版本管理。
      </p>
      {CATEGORIES.map((c) => (
        <CategoryPanel key={c.value} category={c.value} label={c.label} />
      ))}
    </div>
  );
}
