import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

type ScheduleType = 'once' | 'interval' | 'periodic';

interface CronTask {
  id: string;
  name: string;
  enabled: boolean;
  command: string;
  status: string;
  scheduleType: ScheduleType;
  runAt?: string;
  intervalSeconds?: number;
  scheduleTime?: string;
  intervalDays?: number;
  randomDelaySeconds?: number;
  retryCount?: number;
  retryIntervalSeconds?: number;
  retryAttempts?: number;
  nextRunAt?: string;
  lastRunAt?: string;
}

interface TasksPayload {
  tasks: CronTask[];
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
  name: z.string().min(1, 'Name is required'),
  command: z.string(),
  enabled: z.boolean(),
  scheduleType: z.enum(['once', 'interval', 'periodic']),
  runAtDate: z.string().default(''),
  runAtTime: z.string().default(''),
  intervalSeconds: z.number().int().min(1).default(60),
  scheduleTime: z.string().default(''),
  intervalDays: z.number().int().min(1).default(1),
  randomDelaySeconds: z.number().int().min(0).default(0),
  retryCount: z.number().int().min(0).default(1),
  retryIntervalSeconds: z.number().int().min(0).default(0),
});

type TaskFormValues = z.infer<typeof TaskFormSchema>;

const defaultValues: TaskFormValues = {
  name: '',
  command: '',
  enabled: false,
  scheduleType: 'periodic',
  runAtDate: '',
  runAtTime: '',
  intervalSeconds: 60,
  scheduleTime: '',
  intervalDays: 1,
  randomDelaySeconds: 0,
  retryCount: 1,
  retryIntervalSeconds: 0,
};

function isoToDateParts(runAt?: string): { date: string; time: string } {
  if (!runAt) return { date: '', time: '' };
  const d = new Date(runAt);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function partsToISO(date: string, time: string): string {
  if (!date || !time) return '';
  return new Date(`${date}T${time}:00`).toISOString();
}

function taskToFormValues(t: CronTask): TaskFormValues {
  const { date, time } = isoToDateParts(t.runAt);
  return {
    name: t.name,
    command: t.command,
    enabled: t.enabled,
    scheduleType: t.scheduleType ?? 'periodic',
    runAtDate: date,
    runAtTime: time,
    intervalSeconds: t.intervalSeconds ?? 60,
    scheduleTime: t.scheduleTime ?? '',
    intervalDays: t.intervalDays ?? 1,
    randomDelaySeconds: t.randomDelaySeconds ?? 0,
    retryCount: t.retryCount ?? 1,
    retryIntervalSeconds: t.retryIntervalSeconds ?? 0,
  };
}

function formValuesToPayload(v: TaskFormValues) {
  return {
    name: v.name,
    command: v.command,
    enabled: v.enabled,
    scheduleType: v.scheduleType,
    runAt: v.scheduleType === 'once' ? partsToISO(v.runAtDate, v.runAtTime) : '',
    intervalSeconds: v.intervalSeconds,
    scheduleTime: v.scheduleType === 'periodic' ? v.scheduleTime : '',
    intervalDays: v.intervalDays,
    randomDelaySeconds: v.randomDelaySeconds,
    retryCount: v.retryCount,
    retryIntervalSeconds: v.retryIntervalSeconds,
  };
}

const SCHEDULE_TYPES: { value: ScheduleType; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'interval', label: 'Interval' },
  { value: 'periodic', label: 'Periodic' },
];

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: CronTask | null;
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
      form.reset(initial ? taskToFormValues(initial) : defaultValues);
    }
  }, [open, initial, form]);

  const values = form.watch();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Cron Task' : 'New Cron Task'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            await onSubmit(v);
          })}
        >
          {/* Name */}
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input {...form.register('name')} placeholder="Daily backup" />
            {form.formState.errors.name ? (
              <div className="text-xs text-destructive">{form.formState.errors.name.message}</div>
            ) : null}
          </div>

          {/* Schedule type selector */}
          <div className="space-y-1.5">
            <Label>Schedule type</Label>
            <div className="flex gap-1.5">
              {SCHEDULE_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => form.setValue('scheduleType', t.value)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition-all',
                    values.scheduleType === t.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Once: date + time */}
          {values.scheduleType === 'once' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" {...form.register('runAtDate')} className="[color-scheme:dark]" />
              </div>
              <div className="space-y-1.5">
                <Label>Time</Label>
                <Input type="time" {...form.register('runAtTime')} className="[color-scheme:dark]" />
              </div>
            </div>
          ) : null}

          {/* Interval: every N seconds */}
          {values.scheduleType === 'interval' ? (
            <div className="space-y-1.5">
              <Label>Interval (seconds)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  className="w-32"
                  {...form.register('intervalSeconds', { valueAsNumber: true })}
                />
                <span className="text-xs text-muted-foreground">seconds</span>
              </div>
            </div>
          ) : null}

          {/* Periodic: HH:MM + interval days + random delay */}
          {values.scheduleType === 'periodic' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Time (HH:MM)</Label>
                  <Input
                    type="time"
                    {...form.register('scheduleTime')}
                    className="[color-scheme:dark]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Interval (days)</Label>
                  <Input
                    type="number"
                    min={1}
                    {...form.register('intervalDays', { valueAsNumber: true })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Random delay (seconds, 0 = no delay)</Label>
                <Input
                  type="number"
                  min={0}
                  className="w-40"
                  {...form.register('randomDelaySeconds', { valueAsNumber: true })}
                />
              </div>
            </div>
          ) : null}

          {/* Retry */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Retry count</Label>
              <Input
                type="number"
                min={0}
                {...form.register('retryCount', { valueAsNumber: true })}
              />
            </div>
            {values.retryCount > 0 ? (
              <div className="space-y-1.5">
                <Label>Retry interval (seconds)</Label>
                <Input
                  type="number"
                  min={0}
                  {...form.register('retryIntervalSeconds', { valueAsNumber: true })}
                />
              </div>
            ) : null}
          </div>

          {/* Shell command */}
          <div className="space-y-1.5">
            <Label>Shell command</Label>
            <textarea
              {...form.register('command')}
              spellCheck={false}
              className="h-24 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="e.g. /usr/local/bin/backup.sh"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
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
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const { data } = useQuery<{ executions: TaskExecution[] }>({
    queryKey: ['cron', 'executions', taskId],
    queryFn: () =>
      apiGet<{ executions: TaskExecution[] }>(
        `/api/cron/tasks/executions?id=${encodeURIComponent(taskId!)}`,
      ),
    enabled: open,
    refetchInterval: 5000,
  });
  const [activeExec, setActiveExec] = useState<TaskExecution | null>(null);
  const { data: logData } = useQuery<{ log: string }>({
    queryKey: ['cron', 'log', taskId, activeExec?.id],
    queryFn: () =>
      apiGet<{ log: string }>(
        `/api/cron/execution/log?taskId=${encodeURIComponent(taskId!)}&execId=${encodeURIComponent(activeExec!.id)}`,
      ),
    enabled: open && !!activeExec,
    refetchInterval: activeExec?.running ? 3000 : false,
  });

  useEffect(() => {
    if (!open) {
      setActiveExec(null);
      setPage(1);
    }
  }, [open]);

  const allExecs = data?.executions ?? [];
  const totalPages = Math.max(1, Math.ceil(allExecs.length / PAGE_SIZE));
  const pageExecs = allExecs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Execution History</DialogTitle>
          </DialogHeader>
          <div className="rounded-md border border-border">
            {allExecs.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">No execution records</div>
            ) : (
              <>
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-1.5">Start</th>
                      <th className="px-3 py-1.5">End</th>
                      <th className="px-3 py-1.5">Status</th>
                      <th className="px-3 py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageExecs.map((ex) => (
                      <tr key={ex.id} className="border-t border-border">
                        <td className="px-3 py-1.5 font-mono">{new Date(ex.startTime).toLocaleString()}</td>
                        <td className="px-3 py-1.5 font-mono">{ex.endTime ? new Date(ex.endTime).toLocaleString() : '--'}</td>
                        <td className="px-3 py-1.5">
                          {ex.running ? (
                            <Badge variant="secondary">Running</Badge>
                          ) : ex.success ? (
                            <Badge className="bg-green-600 text-white">Success</Badge>
                          ) : (
                            <Badge variant="destructive">Failed</Badge>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <Button size="sm" variant="ghost" onClick={() => setActiveExec(ex)}>
                            Logs
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totalPages > 1 ? (
                  <div className="flex items-center justify-between border-t border-border px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {page} / {totalPages} &nbsp;({allExecs.length} records)
                    </span>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>←</Button>
                      <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>→</Button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!activeExec} onOpenChange={(o) => { if (!o) setActiveExec(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Execution Log
              {activeExec ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {new Date(activeExec.startTime).toLocaleString()}
                  {activeExec.running ? <Badge variant="secondary" className="ml-2">Running</Badge> : null}
                </span>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[60vh] rounded-md border border-border bg-muted/30">
            <pre className="p-3 font-mono text-xs whitespace-pre-wrap">
              {logData?.log || 'Loading…'}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

function scheduleLabel(task: CronTask): string {
  switch (task.scheduleType) {
    case 'once':
      return task.runAt ? `Once: ${new Date(task.runAt).toLocaleString()}` : 'Once (no time set)';
    case 'interval':
      return `Every ${task.intervalSeconds ?? 60}s`;
    case 'periodic': {
      const days = task.intervalDays ?? 1;
      const time = task.scheduleTime || '--:--';
      const prefix = days === 1 ? 'Daily' : `Every ${days}d`;
      return `${prefix} at ${time}`;
    }
  }
}

function statusBadge(task: CronTask) {
  const enabledBadge = task.enabled
    ? <Badge className="bg-green-600 text-white">Enabled</Badge>
    : <Badge variant="outline">Disabled</Badge>;
  if (task.status === 'running') {
    return <>{enabledBadge}<Badge className="bg-green-500 text-white">Running</Badge></>;
  }
  return enabledBadge;
}

function scheduleTypeBadge(type: ScheduleType) {
  const labels: Record<ScheduleType, string> = { once: 'Once', interval: 'Interval', periodic: 'Periodic' };
  return <Badge variant="secondary" className="text-xs">{labels[type]}</Badge>;
}

export function CronJobs() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery<TasksPayload>({
    queryKey: ['cron', 'tasks'],
    queryFn: () => apiGet<TasksPayload>('/api/cron/tasks/list'),
    refetchInterval: 5000,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CronTask | null>(null);
  const [logTaskId, setLogTaskId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (v: TaskFormValues) => apiPost('/api/cron/tasks/create', formValuesToPayload(v)),
    onSuccess: () => {
      setDialogOpen(false);
      toast.success('Task created');
      qc.invalidateQueries({ queryKey: ['cron', 'tasks'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: (v: TaskFormValues & { id: string }) =>
      apiPost('/api/cron/tasks/update', { ...formValuesToPayload(v), id: v.id }),
    onSuccess: () => {
      setDialogOpen(false);
      setEditing(null);
      toast.success('Task updated');
      qc.invalidateQueries({ queryKey: ['cron', 'tasks'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiPost('/api/cron/tasks/delete', { id }),
    onSuccess: () => {
      toast.success('Deleted');
      qc.invalidateQueries({ queryKey: ['cron', 'tasks'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const enable = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiPost(enabled ? '/api/cron/tasks/enable' : '/api/cron/tasks/disable', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cron', 'tasks'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const runNow = useMutation({
    mutationFn: (id: string) => apiPost('/api/cron/tasks/run', { id }),
    onSuccess: () => {
      toast.success('Task started');
      qc.invalidateQueries({ queryKey: ['cron', 'tasks'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tasks = data?.tasks ?? [];
  const pending = create.isPending || update.isPending;

  const handleSubmit = async (values: TaskFormValues) => {
    if (editing) await update.mutateAsync({ ...values, id: editing.id });
    else await create.mutateAsync(values);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Cron</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Tasks</span>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              + New Task
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : tasks.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No tasks. Click "+ New Task" to add one.
            </div>
          ) : (
            tasks.map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    {scheduleTypeBadge(t.scheduleType ?? 'periodic')}
                    {statusBadge(t)}
                  </div>
                  <div className="text-xs text-muted-foreground">{scheduleLabel(t)}</div>
                  {t.command ? (
                    <div className="max-w-md truncate font-mono text-xs text-muted-foreground">
                      $ {t.command}
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground/60">
                    {t.nextRunAt ? <>next: {new Date(t.nextRunAt).toLocaleString()}</> : null}
                    {t.lastRunAt ? (
                      <span className="ml-2">last: {new Date(t.lastRunAt).toLocaleString()}</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runNow.mutate(t.id)}
                    disabled={runNow.isPending}
                  >
                    Run
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => enable.mutate({ id: t.id, enabled: !t.enabled })}
                    disabled={enable.isPending}
                  >
                    {t.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setLogTaskId(t.id)}>
                    Logs
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(t);
                      setDialogOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (window.confirm(`Delete task "${t.name}"?`)) del.mutate(t.id);
                    }}
                    disabled={del.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditing(null);
        }}
        initial={editing}
        onSubmit={handleSubmit}
        pending={pending}
      />
      <ExecutionsDialog taskId={logTaskId} onOpenChange={(o) => !o && setLogTaskId(null)} />
    </div>
  );
}
