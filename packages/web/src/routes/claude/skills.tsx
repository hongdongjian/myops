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

interface SkillItem {
  name: string;
  desc?: string;
  installed: boolean;
  pending?: string;
  error?: string;
}

interface SkillListPayload {
  skills: SkillItem[];
}

interface SkillContent {
  name: string;
  content: string;
}

export function ClaudeSkills() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<SkillListPayload>({
    queryKey: ['claude', 'skills'],
    queryFn: () => apiGet<SkillListPayload>('/api/claude/skills/list'),
    refetchInterval: 5000,
  });

  const [viewing, setViewing] = useState<SkillContent | null>(null);

  const install = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/skills/install', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claude', 'skills'] }),
  });
  const uninstall = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/skills/uninstall', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claude', 'skills'] }),
  });
  const update = useMutation({
    mutationFn: () => apiPost('/api/claude/skills/update'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claude', 'skills'] }),
  });

  const view = async (name: string) => {
    try {
      const res = await apiGet<SkillContent>(`/api/claude/skills/content?name=${encodeURIComponent(name)}`);
      setViewing(res);
    } catch (e) {
      setViewing({ name, content: `加载失败: ${(e as Error).message}` });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Claude Skills</span>
          <Button size="sm" variant="outline" onClick={() => update.mutate()} disabled={update.isPending}>
            {update.isPending ? '更新中...' : '更新 Skills'}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? <div className="text-xs text-muted-foreground">加载中...</div> : null}
        {(data?.skills ?? []).map((s) => (
          <div key={s.name} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
            <div>
              <button className="font-medium hover:underline" onClick={() => s.installed && view(s.name)} disabled={!s.installed}>
                {s.name}
              </button>
              {s.desc ? <div className="text-xs text-muted-foreground">{s.desc}</div> : null}
              {s.pending ? <div className="text-xs text-amber-500">{s.pending} 中...</div> : null}
              {s.error ? <div className="text-xs text-destructive">{s.error}</div> : null}
            </div>
            <div className="flex gap-2">
              {s.installed ? (
                <Button size="sm" variant="outline" onClick={() => uninstall.mutate(s.name)} disabled={!!s.pending}>
                  卸载
                </Button>
              ) : (
                <Button size="sm" onClick={() => install.mutate(s.name)} disabled={!!s.pending}>
                  安装
                </Button>
              )}
            </div>
          </div>
        ))}
        {!isLoading && (data?.skills ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">无可用 Skills</div>
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
