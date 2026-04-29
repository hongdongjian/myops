import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ModelSelect } from '@/components/model-select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ScheduledTask {
  id: string;
  name: string;
  enabled: boolean;
  scheduleTime: string;
  randomDelay: boolean;
  randomDelayMax: number;
  mustSucceedDaily: boolean;
  model: string;
  prompt: string;
  status: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastSuccessDate?: string;
}

interface TasksPayload {
  tasks: ScheduledTask[];
}

interface TaskExecution {
  id: string;
  taskId: string;
  startTime: string;
  endTime?: string;
  success: boolean;
  running: boolean;
  logFile: string;
  errorMsg?: string;
}

const TaskFormSchema = z.object({
  name: z.string().min(1, '请输入任务名称'),
  scheduleTime: z.string().min(1, '请输入计划时间，如 09:30'),
  randomDelay: z.boolean(),
  randomDelayMax: z.number().int().min(0),
  mustSucceedDaily: z.boolean(),
  model: z.string(),
  prompt: z.string(),
  enabled: z.boolean(),
});

type TaskFormValues = z.infer<typeof TaskFormSchema>;

const defaultValues: TaskFormValues = {
  name: '',
  scheduleTime: '',
  randomDelay: false,
  randomDelayMax: 0,
  mustSucceedDaily: false,
  model: '',
  prompt: '',
  enabled: false,
};

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: ScheduledTask | null;
  onSubmit: (values: TaskFormValues) => Promise<void> | void;
  pending: boolean;
}

function TaskDialog({ open, onOpenChange, initial, onSubmit, pending }: TaskDialogProps) {
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(TaskFormSchema),
    defaultValues,
  });

  useEffect(() => {
    if (open) {
      form.reset(initial
        ? {
            name: initial.name,
            scheduleTime: initial.scheduleTime,
            randomDelay: initial.randomDelay,
            randomDelayMax: initial.randomDelayMax,
            mustSucceedDaily: initial.mustSucceedDaily,
            model: initial.model,
            prompt: initial.prompt,
            enabled: initial.enabled,
          }
        : defaultValues);
    }
  }, [open, initial, form]);

  const values = form.watch();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? '编辑任务' : '新建任务'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={form.handleSubmit(async (v) => {
            await onSubmit(v);
          })}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>名称</Label>
              <Input {...form.register('name')} placeholder="每日例行" />
              {form.formState.errors.name ? (
                <div className="text-xs text-destructive">{form.formState.errors.name.message}</div>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label>计划时间 (HH:MM)</Label>
              <Input {...form.register('scheduleTime')} placeholder="09:30" />
              {form.formState.errors.scheduleTime ? (
                <div className="text-xs text-destructive">{form.formState.errors.scheduleTime.message}</div>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label>模型</Label>
              <ModelSelect value={values.model} onChange={(v) => form.setValue('model', v)} />
            </div>
            <div className="space-y-1">
              <Label>随机延迟 (分钟)</Label>
              <Input
                type="number"
                min={0}
                {...form.register('randomDelayMax', { valueAsNumber: true })}
                disabled={!values.randomDelay}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded border border-border p-2">
            <Label>启用随机延迟</Label>
            <Switch checked={values.randomDelay} onCheckedChange={(v) => form.setValue('randomDelay', v)} />
          </div>
          <div className="flex items-center justify-between rounded border border-border p-2">
            <Label>每日必须成功 (失败重试到当天 23:59)</Label>
            <Switch checked={values.mustSucceedDaily} onCheckedChange={(v) => form.setValue('mustSucceedDaily', v)} />
          </div>
          <div className="flex items-center justify-between rounded border border-border p-2">
            <Label>启用</Label>
            <Switch checked={values.enabled} onCheckedChange={(v) => form.setValue('enabled', v)} />
          </div>
          <div className="space-y-1">
            <Label>Prompt</Label>
            <textarea
              {...form.register('prompt')}
              spellCheck={false}
              className="h-40 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
              placeholder="输入要发送给 claude 的 prompt"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ExecutionsDialogProps {
  taskId: string | null;
  onOpenChange: (open: boolean) => void;
}

function ExecutionsDialog({ taskId, onOpenChange }: ExecutionsDialogProps) {
  const open = !!taskId;
  const { data } = useQuery<{ executions: TaskExecution[] }>({
    queryKey: ['scheduler', 'executions', taskId],
    queryFn: () => apiGet<{ executions: TaskExecution[] }>(`/api/scheduler/tasks/executions?id=${encodeURIComponent(taskId!)}`),
    enabled: open,
    refetchInterval: 5000,
  });
  const [activeExec, setActiveExec] = useState<string | null>(null);
  const { data: logData } = useQuery<{ log: string }>({
    queryKey: ['scheduler', 'log', taskId, activeExec],
    queryFn: () => apiGet<{ log: string }>(`/api/scheduler/execution/log?taskId=${encodeURIComponent(taskId!)}&execId=${encodeURIComponent(activeExec!)}`),
    enabled: open && !!activeExec,
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (!open) setActiveExec(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>执行历史</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="max-h-48 overflow-auto rounded border border-border">
            {(data?.executions ?? []).length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">暂无执行记录</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-2 py-1">开始</th>
                    <th className="px-2 py-1">结束</th>
                    <th className="px-2 py-1">状态</th>
                    <th className="px-2 py-1">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.executions ?? []).map((ex) => (
                    <tr key={ex.id} className="border-t border-border">
                      <td className="px-2 py-1 font-mono">{ex.startTime}</td>
                      <td className="px-2 py-1 font-mono">{ex.endTime || '--'}</td>
                      <td className="px-2 py-1">
                        {ex.running ? (
                          <Badge variant="secondary">运行中</Badge>
                        ) : ex.success ? (
                          <Badge className="bg-green-600 text-white">成功</Badge>
                        ) : (
                          <Badge variant="destructive">失败</Badge>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <Button size="sm" variant="ghost" onClick={() => setActiveExec(ex.id)}>查看日志</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {activeExec ? (
            <ScrollArea className="h-[40vh] rounded border border-border bg-muted/30">
              <pre className="p-3 font-mono text-xs whitespace-pre-wrap">{logData?.log || '加载中...'}</pre>
            </ScrollArea>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Scheduler() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<TasksPayload>({
    queryKey: ['scheduler', 'tasks'],
    queryFn: () => apiGet<TasksPayload>('/api/scheduler/tasks/list'),
    refetchInterval: 5000,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledTask | null>(null);
  const [logTaskId, setLogTaskId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (v: TaskFormValues) => apiPost('/api/scheduler/tasks/create', v),
    onSuccess: () => {
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ['scheduler', 'tasks'] });
    },
  });
  const update = useMutation({
    mutationFn: (v: TaskFormValues & { id: string }) => apiPost('/api/scheduler/tasks/update', v),
    onSuccess: () => {
      setDialogOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['scheduler', 'tasks'] });
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => apiPost('/api/scheduler/tasks/delete', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduler', 'tasks'] }),
  });
  const enable = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiPost(enabled ? '/api/scheduler/tasks/enable' : '/api/scheduler/tasks/disable', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduler', 'tasks'] }),
  });
  const runNow = useMutation({
    mutationFn: (id: string) => apiPost('/api/scheduler/tasks/run', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduler', 'tasks'] }),
  });

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const pending = create.isPending || update.isPending;

  const handleSubmit = async (values: TaskFormValues) => {
    if (editing) await update.mutateAsync({ ...values, id: editing.id });
    else await create.mutateAsync(values);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>调度任务</span>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>新建任务</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? <div className="text-xs text-muted-foreground">加载中...</div> : null}
          {!isLoading && tasks.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无任务，点击「新建任务」添加。</div>
          ) : null}
          {tasks.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">名称</th>
                  <th className="px-2 py-1">时间</th>
                  <th className="px-2 py-1">模型</th>
                  <th className="px-2 py-1">下次运行</th>
                  <th className="px-2 py-1">最近</th>
                  <th className="px-2 py-1">状态</th>
                  <th className="px-2 py-1">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-2 py-2 font-medium">{t.name}</td>
                    <td className="px-2 py-2 font-mono text-xs">
                      {t.scheduleTime || '--'}
                      {t.randomDelay ? <span className="ml-1 text-muted-foreground">+随机{t.randomDelayMax}m</span> : null}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">{t.model || '--'}</td>
                    <td className="px-2 py-2 font-mono text-xs">{t.nextRunAt || '--'}</td>
                    <td className="px-2 py-2 font-mono text-xs">{t.lastRunAt || '--'}</td>
                    <td className="px-2 py-2 text-xs">
                      <div className="flex items-center gap-1">
                        {t.enabled ? (
                          <Badge className="bg-green-600 text-white">启用</Badge>
                        ) : (
                          <Badge variant="secondary">禁用</Badge>
                        )}
                        {t.status ? <span className="text-muted-foreground">{t.status}</span> : null}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" onClick={() => runNow.mutate(t.id)} disabled={runNow.isPending}>立即运行</Button>
                        <Button size="sm" variant="outline" onClick={() => enable.mutate({ id: t.id, enabled: !t.enabled })}>
                          {t.enabled ? '禁用' : '启用'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setLogTaskId(t.id)}>日志</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(t); setDialogOpen(true); }}>编辑</Button>
                        <Button size="sm" variant="destructive" onClick={() => { if (window.confirm(`删除任务 ${t.name}?`)) del.mutate(t.id); }}>删除</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </CardContent>
      </Card>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}
        initial={editing}
        onSubmit={handleSubmit}
        pending={pending}
      />
      <ExecutionsDialog taskId={logTaskId} onOpenChange={(o) => !o && setLogTaskId(null)} />
    </div>
  );
}
