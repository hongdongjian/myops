import { useState } from 'react';
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

interface Provider {
  name: string;
  baseUrl: string;
  token: string;
  model: string;
  haikuModel: string;
}

interface ProvidersPayload {
  providers: Provider[];
  activeProvider: string;
}

const empty: Provider = { name: '', baseUrl: '', token: '', model: '', haikuModel: '' };

export function ClaudeProviders() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<ProvidersPayload>({
    queryKey: ['claude', 'providers'],
    queryFn: () => apiGet<ProvidersPayload>('/api/claude/providers'),
  });

  const [editing, setEditing] = useState<{ original: string | null; form: Provider } | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [actionErr, setActionErr] = useState('');

  const add = useMutation({
    mutationFn: (p: Provider) => apiPost('/api/claude/providers/add', p),
    onSuccess: () => {
      setEditing(null);
      setActionMsg('已添加');
      qc.invalidateQueries({ queryKey: ['claude', 'providers'] });
    },
    onError: (e: Error) => setActionErr(e.message),
  });
  const update = useMutation({
    mutationFn: ({ original, p }: { original: string; p: Provider }) =>
      apiPost('/api/claude/providers/update', {
        name: original,
        newName: p.name,
        baseUrl: p.baseUrl,
        token: p.token,
        model: p.model,
        haikuModel: p.haikuModel,
      }),
    onSuccess: () => {
      setEditing(null);
      setActionMsg('已更新');
      qc.invalidateQueries({ queryKey: ['claude', 'providers'] });
    },
    onError: (e: Error) => setActionErr(e.message),
  });
  const del = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/providers/delete', { name }),
    onSuccess: () => {
      setActionMsg('已删除');
      qc.invalidateQueries({ queryKey: ['claude', 'providers'] });
    },
    onError: (e: Error) => setActionErr(e.message),
  });
  const apply = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/providers/apply', { name }),
    onSuccess: () => {
      setActionMsg('已应用');
      qc.invalidateQueries({ queryKey: ['claude', 'providers'] });
    },
    onError: (e: Error) => setActionErr(e.message),
  });

  const handleSubmit = () => {
    if (!editing) return;
    setActionErr('');
    setActionMsg('');
    if (!editing.form.name.trim()) {
      setActionErr('name 必填');
      return;
    }
    if (editing.original) {
      update.mutate({ original: editing.original, p: editing.form });
    } else {
      add.mutate(editing.form);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>模型路由 / 供应商</span>
          <Button size="sm" onClick={() => setEditing({ original: null, form: { ...empty } })}>
            + 新增供应商
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? <div className="text-xs text-destructive">{(error as Error).message}</div> : null}
        {isLoading ? <div className="text-xs text-muted-foreground">加载中...</div> : null}
        {(data?.providers ?? []).map((p) => {
          const active = data?.activeProvider === p.name;
          return (
            <div key={p.name} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 font-medium">
                  {p.name}
                  {active ? <Badge className="bg-green-600 text-white">当前</Badge> : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  base: <code>{p.baseUrl || '--'}</code>
                </div>
                <div className="text-xs text-muted-foreground">
                  model: <code>{p.model || '--'}</code> · haiku: <code>{p.haikuModel || '--'}</code>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => apply.mutate(p.name)} disabled={apply.isPending}>
                  应用
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing({ original: p.name, form: { ...p } })}>
                  编辑
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (window.confirm(`删除 provider ${p.name}？`)) del.mutate(p.name);
                  }}
                  disabled={del.isPending}
                >
                  删除
                </Button>
              </div>
            </div>
          );
        })}
        {!isLoading && (data?.providers ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">暂无供应商</div>
        ) : null}
        {actionMsg ? <div className="text-xs text-green-500">{actionMsg}</div> : null}
        {actionErr ? <div className="text-xs text-destructive">{actionErr}</div> : null}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.original ? '编辑供应商' : '新增供应商'}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="grid gap-3">
              <div className="space-y-1">
                <Label>name</Label>
                <Input
                  value={editing.form.name}
                  onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })}
                />
              </div>
              <div className="space-y-1">
                <Label>baseUrl</Label>
                <Input
                  value={editing.form.baseUrl}
                  onChange={(e) => setEditing({ ...editing, form: { ...editing.form, baseUrl: e.target.value } })}
                />
              </div>
              <div className="space-y-1">
                <Label>token</Label>
                <Input
                  value={editing.form.token}
                  onChange={(e) => setEditing({ ...editing, form: { ...editing.form, token: e.target.value } })}
                />
              </div>
              <div className="space-y-1">
                <Label>model</Label>
                <Input
                  value={editing.form.model}
                  onChange={(e) => setEditing({ ...editing, form: { ...editing.form, model: e.target.value } })}
                />
              </div>
              <div className="space-y-1">
                <Label>haikuModel</Label>
                <Input
                  value={editing.form.haikuModel}
                  onChange={(e) => setEditing({ ...editing, form: { ...editing.form, haikuModel: e.target.value } })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={add.isPending || update.isPending}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
