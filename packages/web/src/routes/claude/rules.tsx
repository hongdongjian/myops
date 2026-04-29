import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface RuleItem {
  name: string;
  installed: boolean;
}

interface RuleListPayload {
  rules: RuleItem[];
}

interface RuleContent {
  name: string;
  content: string;
}

export function ClaudeRules() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<RuleListPayload>({
    queryKey: ['claude', 'rules'],
    queryFn: () => apiGet<RuleListPayload>('/api/claude/rules/list'),
  });

  const [viewing, setViewing] = useState<RuleContent | null>(null);

  const install = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/rules/install', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claude', 'rules'] }),
  });
  const uninstall = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/rules/uninstall', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claude', 'rules'] }),
  });

  const view = async (name: string) => {
    try {
      const res = await apiGet<RuleContent>(`/api/claude/rules/content?name=${encodeURIComponent(name)}`);
      setViewing(res);
    } catch (e) {
      setViewing({ name, content: `加载失败: ${(e as Error).message}` });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claude Rules</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-xs text-muted-foreground">来源: <code>conf/claude/rules/</code></div>
        {isLoading ? <div className="text-xs text-muted-foreground">加载中...</div> : null}
        {(data?.rules ?? []).map((r) => (
          <div key={r.name} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
            <button className="font-medium hover:underline" onClick={() => view(r.name)}>
              {r.name}
            </button>
            <div className="flex gap-2">
              {r.installed ? (
                <Button size="sm" variant="outline" onClick={() => uninstall.mutate(r.name)} disabled={uninstall.isPending}>
                  卸载
                </Button>
              ) : (
                <Button size="sm" onClick={() => install.mutate(r.name)} disabled={install.isPending}>
                  安装
                </Button>
              )}
            </div>
          </div>
        ))}
        {!isLoading && (data?.rules ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">无可用 Rules</div>
        ) : null}
      </CardContent>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{viewing?.name}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[60vh] rounded border border-border bg-muted/30">
            <pre className="p-3 font-mono text-xs whitespace-pre-wrap">{viewing?.content}</pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
