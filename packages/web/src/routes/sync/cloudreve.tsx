import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface CloudreveConfig {
  baseUrl: string;
  email: string;
  password: string;
}

interface CloudreveTask {
  id: string;
  name: string;
  src: string;
  dstPath: string;
  policyId: string;
  userHashId: string;
  recursive: boolean;
  extractMediaMeta: boolean;
  enabled: boolean;
  status: string;
  lastRunAt?: string;
  errorMsg?: string;
}

interface CloudrevePolicy { id: string; name: string; type: string; }
interface CloudreveUser { hashId: string; email: string; nick: string; }

const emptyTask = {
  name: '',
  src: '',
  dstPath: '',
  policyId: '',
  userHashId: '',
  recursive: false,
  extractMediaMeta: false,
  enabled: false,
};

export function CloudreveTab() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery<CloudreveConfig>({
    queryKey: ['cloudreve', 'config'],
    queryFn: () => apiGet<CloudreveConfig>('/api/cloudreve/config'),
  });
  const { data: tasksData } = useQuery<{ tasks: CloudreveTask[] }>({
    queryKey: ['cloudreve', 'tasks'],
    queryFn: () => apiGet<{ tasks: CloudreveTask[] }>('/api/cloudreve/tasks/list'),
    refetchInterval: 5000,
  });
  const { data: policiesData } = useQuery<{ policies: CloudrevePolicy[] }>({
    queryKey: ['cloudreve', 'policies'],
    queryFn: () => apiGet<{ policies: CloudrevePolicy[] }>('/api/cloudreve/policies'),
    enabled: !!cfg?.baseUrl,
    retry: false,
  });
  const { data: usersData } = useQuery<{ users: CloudreveUser[] }>({
    queryKey: ['cloudreve', 'users'],
    queryFn: () => apiGet<{ users: CloudreveUser[] }>('/api/cloudreve/users'),
    enabled: !!cfg?.baseUrl,
    retry: false,
  });

  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (cfg) {
      setBaseUrl(cfg.baseUrl);
      setEmail(cfg.email);
      setPassword(cfg.password);
    }
  }, [cfg]);

  const saveCfg = useMutation({
    mutationFn: () => apiPost('/api/cloudreve/config/save', { baseUrl, email, password }),
    onSuccess: () => {
      setNotice('配置已保存');
      setError('');
      qc.invalidateQueries({ queryKey: ['cloudreve'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const testCfg = useMutation({
    mutationFn: () => apiPost('/api/cloudreve/config/test', { baseUrl, email, password }),
    onSuccess: () => { setNotice('连接成功'); setError(''); },
    onError: (e: Error) => setError(e.message),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CloudreveTask | null>(null);
  const [form, setForm] = useState({ ...emptyTask });

  useEffect(() => {
    if (dialogOpen) {
      setForm(editing
        ? {
            name: editing.name,
            src: editing.src,
            dstPath: editing.dstPath,
            policyId: editing.policyId,
            userHashId: editing.userHashId,
            recursive: editing.recursive,
            extractMediaMeta: editing.extractMediaMeta,
            enabled: editing.enabled,
          }
        : { ...emptyTask });
    }
  }, [dialogOpen, editing]);

  const create = useMutation({
    mutationFn: (v: typeof emptyTask) => apiPost('/api/cloudreve/tasks/create', v),
    onSuccess: () => { setDialogOpen(false); qc.invalidateQueries({ queryKey: ['cloudreve', 'tasks'] }); },
  });
  const update = useMutation({
    mutationFn: (v: typeof emptyTask & { id: string }) => apiPost('/api/cloudreve/tasks/update', v),
    onSuccess: () => { setDialogOpen(false); setEditing(null); qc.invalidateQueries({ queryKey: ['cloudreve', 'tasks'] }); },
  });
  const del = useMutation({
    mutationFn: (id: string) => apiPost('/api/cloudreve/tasks/delete', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloudreve', 'tasks'] }),
  });
  const run = useMutation({
    mutationFn: (id: string) => apiPost('/api/cloudreve/tasks/run', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloudreve', 'tasks'] }),
  });

  const handleSave = () => {
    if (editing) update.mutate({ ...form, id: editing.id });
    else create.mutate(form);
  };

  const tasks = tasksData?.tasks ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Cloudreve 配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label>baseUrl</Label><Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></div>
            <div className="space-y-1"><Label>email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="space-y-1"><Label>password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => saveCfg.mutate()} disabled={saveCfg.isPending}>保存</Button>
            <Button variant="outline" onClick={() => testCfg.mutate()} disabled={testCfg.isPending}>测试连接</Button>
          </div>
          {notice ? <div className="text-xs text-green-500">{notice}</div> : null}
          {error ? <div className="text-xs text-destructive">{error}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>同步任务</span>
            <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>新建任务</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无任务</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">名称</th>
                  <th className="px-2 py-1">源</th>
                  <th className="px-2 py-1">目标</th>
                  <th className="px-2 py-1">状态</th>
                  <th className="px-2 py-1">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-2 py-2 font-medium">{t.name}</td>
                    <td className="px-2 py-2 font-mono text-xs">{t.src}</td>
                    <td className="px-2 py-2 font-mono text-xs">{t.dstPath}</td>
                    <td className="px-2 py-2 text-xs">
                      <div className="flex flex-col gap-1">
                        {t.enabled ? <Badge className="bg-green-600 text-white">启用</Badge> : <Badge variant="secondary">禁用</Badge>}
                        {t.status ? <span className="text-muted-foreground">{t.status}</span> : null}
                        {t.errorMsg ? <span className="text-destructive">{t.errorMsg}</span> : null}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" onClick={() => run.mutate(t.id)}>运行</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(t); setDialogOpen(true); }}>编辑</Button>
                        <Button size="sm" variant="destructive" onClick={() => { if (window.confirm(`删除任务 ${t.name}?`)) del.mutate(t.id); }}>删除</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? '编辑任务' : '新建任务'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>名称</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-1"><Label>本地源路径</Label><Input value={form.src} onChange={(e) => setForm({ ...form, src: e.target.value })} /></div>
              <div className="space-y-1"><Label>目标路径</Label><Input value={form.dstPath} onChange={(e) => setForm({ ...form, dstPath: e.target.value })} /></div>
              <div className="space-y-1">
                <Label>存储策略</Label>
                <Select value={form.policyId} onValueChange={(v) => setForm({ ...form, policyId: v })}>
                  <SelectTrigger><SelectValue placeholder="选择策略" /></SelectTrigger>
                  <SelectContent>
                    {(policiesData?.policies ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>用户</Label>
                <Select value={form.userHashId} onValueChange={(v) => setForm({ ...form, userHashId: v })}>
                  <SelectTrigger><SelectValue placeholder="选择用户" /></SelectTrigger>
                  <SelectContent>
                    {(usersData?.users ?? []).map((u) => (
                      <SelectItem key={u.hashId} value={u.hashId}>{u.nick} ({u.email})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between rounded border border-border p-2">
              <Label>递归子目录</Label>
              <Switch checked={form.recursive} onCheckedChange={(v) => setForm({ ...form, recursive: v })} />
            </div>
            <div className="flex items-center justify-between rounded border border-border p-2">
              <Label>提取媒体元信息</Label>
              <Switch checked={form.extractMediaMeta} onCheckedChange={(v) => setForm({ ...form, extractMediaMeta: v })} />
            </div>
            <div className="flex items-center justify-between rounded border border-border p-2">
              <Label>启用任务</Label>
              <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={create.isPending || update.isPending}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
