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

interface ImmichAccount { id: string; name: string; email: string; apiKey: string; baseUrl: string; }
interface ImmichPerson { id: string; name: string; isHidden: boolean; }
interface ImmichAlbum { id: string; albumName: string; assetCount: number; }
interface ImmichSyncPlan {
  id: string;
  accountId?: string;
  name: string;
  personIds: string[];
  personNames: string[];
  albumId: string;
  albumName: string;
  removeDeleted: boolean;
  enabled: boolean;
  scheduleInterval: number;
  status: string;
  lastRunAt?: string;
  lastRunStats?: { added: number; removed: number; total: number };
  errorMsg?: string;
}

const emptyPlan = {
  name: '',
  accountId: '',
  personIds: [] as string[],
  personNames: [] as string[],
  albumId: '',
  albumName: '',
  removeDeleted: false,
  enabled: false,
  scheduleInterval: 0,
};

export function ImmichTab() {
  const qc = useQueryClient();
  const { data: accountsData } = useQuery<{ accounts: ImmichAccount[]; activeId: string }>({
    queryKey: ['immich', 'accounts'],
    queryFn: () => apiGet<{ accounts: ImmichAccount[]; activeId: string }>('/api/immich/accounts'),
  });
  const { data: peopleData } = useQuery<{ people: ImmichPerson[] }>({
    queryKey: ['immich', 'people'],
    queryFn: () => apiGet<{ people: ImmichPerson[] }>('/api/immich/people'),
    enabled: !!accountsData?.activeId,
    retry: false,
  });
  const { data: albumsData } = useQuery<{ albums: ImmichAlbum[] }>({
    queryKey: ['immich', 'albums'],
    queryFn: () => apiGet<{ albums: ImmichAlbum[] }>('/api/immich/albums'),
    enabled: !!accountsData?.activeId,
    retry: false,
  });
  const { data: plansData } = useQuery<{ plans: ImmichSyncPlan[] }>({
    queryKey: ['immich', 'plans'],
    queryFn: () => apiGet<{ plans: ImmichSyncPlan[] }>('/api/immich/sync/plans'),
    refetchInterval: 5000,
  });

  const [addOpen, setAddOpen] = useState(false);
  const [accForm, setAccForm] = useState({ name: '', baseUrl: '', apiKey: '' });
  const [error, setError] = useState('');

  const addAccount = useMutation({
    mutationFn: () => apiPost('/api/immich/accounts/add', accForm),
    onSuccess: () => {
      setAddOpen(false);
      setAccForm({ name: '', baseUrl: '', apiKey: '' });
      qc.invalidateQueries({ queryKey: ['immich'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const switchAcc = useMutation({
    mutationFn: (id: string) => apiPost('/api/immich/accounts/switch', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['immich'] }),
  });
  const delAcc = useMutation({
    mutationFn: (id: string) => apiPost('/api/immich/accounts/delete', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['immich'] }),
  });

  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ImmichSyncPlan | null>(null);
  const [planForm, setPlanForm] = useState({ ...emptyPlan });

  useEffect(() => {
    if (planDialogOpen) {
      setPlanForm(editing
        ? {
            name: editing.name,
            accountId: editing.accountId ?? '',
            personIds: editing.personIds ?? [],
            personNames: editing.personNames ?? [],
            albumId: editing.albumId,
            albumName: editing.albumName ?? '',
            removeDeleted: editing.removeDeleted,
            enabled: editing.enabled,
            scheduleInterval: editing.scheduleInterval,
          }
        : { ...emptyPlan, accountId: accountsData?.activeId ?? '' });
    }
  }, [planDialogOpen, editing, accountsData]);

  const createPlan = useMutation({
    mutationFn: (v: typeof emptyPlan) => apiPost('/api/immich/sync/plans/create', v),
    onSuccess: () => { setPlanDialogOpen(false); qc.invalidateQueries({ queryKey: ['immich', 'plans'] }); },
  });
  const updatePlan = useMutation({
    mutationFn: (v: typeof emptyPlan & { id: string }) => apiPost('/api/immich/sync/plans/update', v),
    onSuccess: () => { setPlanDialogOpen(false); setEditing(null); qc.invalidateQueries({ queryKey: ['immich', 'plans'] }); },
  });
  const delPlan = useMutation({
    mutationFn: (id: string) => apiPost('/api/immich/sync/plans/delete', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['immich', 'plans'] }),
  });
  const runPlan = useMutation({
    mutationFn: (id: string) => apiPost('/api/immich/sync/plans/run', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['immich', 'plans'] }),
  });
  const togglePlan = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiPost(enabled ? '/api/immich/sync/plans/enable' : '/api/immich/sync/plans/disable', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['immich', 'plans'] }),
  });

  const accounts = accountsData?.accounts ?? [];
  const plans = plansData?.plans ?? [];
  const people = peopleData?.people ?? [];
  const albums = albumsData?.albums ?? [];

  const handleSavePlan = () => {
    const personNames = planForm.personIds.map((id) => people.find((p) => p.id === id)?.name ?? '');
    const albumName = albums.find((a) => a.id === planForm.albumId)?.albumName ?? '';
    const payload = { ...planForm, personNames, albumName };
    if (editing) updatePlan.mutate({ ...payload, id: editing.id });
    else createPlan.mutate(payload);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Immich 账号</span>
            <Button size="sm" onClick={() => setAddOpen(true)}>添加账号</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {accounts.length === 0 ? (
            <div className="text-sm text-muted-foreground">尚未配置账号</div>
          ) : (
            accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded border border-border p-2">
                <div>
                  <div className="font-medium">{a.name}{accountsData?.activeId === a.id ? <Badge className="ml-2">当前</Badge> : null}</div>
                  <div className="text-xs text-muted-foreground">{a.email} · {a.baseUrl}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={accountsData?.activeId === a.id} onClick={() => switchAcc.mutate(a.id)}>切换</Button>
                  <Button size="sm" variant="destructive" onClick={() => { if (window.confirm(`删除账号 ${a.name}?`)) delAcc.mutate(a.id); }}>删除</Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>同步计划</span>
            <Button size="sm" onClick={() => { setEditing(null); setPlanDialogOpen(true); }}>新建计划</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {plans.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无计划</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">名称</th>
                  <th className="px-2 py-1">人物</th>
                  <th className="px-2 py-1">相册</th>
                  <th className="px-2 py-1">间隔</th>
                  <th className="px-2 py-1">状态</th>
                  <th className="px-2 py-1">操作</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-2 py-2 font-medium">{p.name}</td>
                    <td className="px-2 py-2 text-xs">{(p.personNames ?? []).join(', ') || '--'}</td>
                    <td className="px-2 py-2 text-xs">{p.albumName || p.albumId}</td>
                    <td className="px-2 py-2 text-xs">{p.scheduleInterval ? `${p.scheduleInterval} 分钟` : '手动'}</td>
                    <td className="px-2 py-2 text-xs">
                      <div className="flex flex-col gap-1">
                        {p.enabled ? <Badge className="bg-green-600 text-white">启用</Badge> : <Badge variant="secondary">禁用</Badge>}
                        {p.status ? <span className="text-muted-foreground">{p.status}</span> : null}
                        {p.errorMsg ? <span className="text-destructive">{p.errorMsg}</span> : null}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" onClick={() => runPlan.mutate(p.id)}>运行</Button>
                        <Button size="sm" variant="outline" onClick={() => togglePlan.mutate({ id: p.id, enabled: !p.enabled })}>
                          {p.enabled ? '禁用' : '启用'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(p); setPlanDialogOpen(true); }}>编辑</Button>
                        <Button size="sm" variant="destructive" onClick={() => { if (window.confirm(`删除计划 ${p.name}?`)) delPlan.mutate(p.id); }}>删除</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>添加 Immich 账号</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>名称 (可选)</Label><Input value={accForm.name} onChange={(e) => setAccForm({ ...accForm, name: e.target.value })} /></div>
            <div className="space-y-1"><Label>baseUrl</Label><Input value={accForm.baseUrl} onChange={(e) => setAccForm({ ...accForm, baseUrl: e.target.value })} placeholder="http://localhost:2283" /></div>
            <div className="space-y-1"><Label>API Key</Label><Input value={accForm.apiKey} onChange={(e) => setAccForm({ ...accForm, apiKey: e.target.value })} /></div>
            {error ? <div className="text-xs text-destructive">{error}</div> : null}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
            <Button onClick={() => addAccount.mutate()} disabled={addAccount.isPending || !accForm.apiKey}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={planDialogOpen} onOpenChange={(o) => { setPlanDialogOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? '编辑计划' : '新建计划'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>名称</Label><Input value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} /></div>
              <div className="space-y-1">
                <Label>账号</Label>
                <Select value={planForm.accountId} onValueChange={(v) => setPlanForm({ ...planForm, accountId: v })}>
                  <SelectTrigger><SelectValue placeholder="选择账号" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (<SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>相册</Label>
                <Select value={planForm.albumId} onValueChange={(v) => setPlanForm({ ...planForm, albumId: v })}>
                  <SelectTrigger><SelectValue placeholder="选择相册" /></SelectTrigger>
                  <SelectContent>
                    {albums.map((a) => (<SelectItem key={a.id} value={a.id}>{a.albumName}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>调度间隔 (分钟, 0=手动)</Label>
                <Input type="number" min={0} value={planForm.scheduleInterval}
                  onChange={(e) => setPlanForm({ ...planForm, scheduleInterval: Number(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>人物 (多选)</Label>
              <select
                multiple
                size={6}
                className="w-full rounded-md border border-border bg-muted/30 p-2 text-sm"
                value={planForm.personIds}
                onChange={(e) => {
                  const ids = Array.from(e.target.selectedOptions).map((o) => o.value);
                  setPlanForm({ ...planForm, personIds: ids });
                }}
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name || '(未命名)'}</option>
                ))}
              </select>
              <div className="text-xs text-muted-foreground">已选: {planForm.personIds.length}</div>
            </div>
            <div className="flex items-center justify-between rounded border border-border p-2">
              <Label>同步删除</Label>
              <Switch checked={planForm.removeDeleted} onCheckedChange={(v) => setPlanForm({ ...planForm, removeDeleted: v })} />
            </div>
            <div className="flex items-center justify-between rounded border border-border p-2">
              <Label>启用</Label>
              <Switch checked={planForm.enabled} onCheckedChange={(v) => setPlanForm({ ...planForm, enabled: v })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPlanDialogOpen(false)}>取消</Button>
            <Button onClick={handleSavePlan} disabled={createPlan.isPending || updatePlan.isPending || planForm.personIds.length === 0 || !planForm.albumId}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
