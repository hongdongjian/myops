import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PresetStatus {
  name: string;
  description: string;
  installedLocal: boolean;
  installedProject: boolean;
  installedUser: boolean;
}

interface MCPListPayload {
  paths: {
    local: string;
    project: string;
    user: string;
    localExists: boolean;
    projectExists: boolean;
    userExists: boolean;
  };
  installed: { local: string[]; project: string[]; user: string[] };
  supported: PresetStatus[];
  others: { local: string[]; project: string[]; user: string[] };
}

const SCOPES = ['project', 'user', 'local'] as const;
type Scope = (typeof SCOPES)[number];

export function ClaudeMcp() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<MCPListPayload>({
    queryKey: ['claude', 'mcp', 'list'],
    queryFn: () => apiGet<MCPListPayload>('/api/claude/mcp/list'),
  });

  const [name, setName] = useState('');
  const [transport, setTransport] = useState('http');
  const [target, setTarget] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [actionErr, setActionErr] = useState('');

  const presetInstall = useMutation({
    mutationFn: ({ name, scope }: { name: string; scope: Scope }) =>
      apiPost('/api/claude/mcp/preset/install', { name, scope }),
    onSuccess: () => {
      setActionMsg('安装完成');
      qc.invalidateQueries({ queryKey: ['claude', 'mcp', 'list'] });
    },
    onError: (e: Error) => setActionErr(e.message),
  });
  const presetRemove = useMutation({
    mutationFn: ({ name, scope }: { name: string; scope: Scope | 'all' }) =>
      apiPost('/api/claude/mcp/preset/remove', { name, scope }),
    onSuccess: () => {
      setActionMsg('卸载完成');
      qc.invalidateQueries({ queryKey: ['claude', 'mcp', 'list'] });
    },
    onError: (e: Error) => setActionErr(e.message),
  });
  const add = useMutation({
    mutationFn: () => apiPost('/api/claude/mcp/add', { name, transport, target }),
    onSuccess: () => {
      setActionMsg('已添加');
      setName('');
      setTarget('');
      qc.invalidateQueries({ queryKey: ['claude', 'mcp', 'list'] });
    },
    onError: (e: Error) => setActionErr(e.message),
  });
  const remove = useMutation({
    mutationFn: (n: string) => apiPost('/api/claude/mcp/remove', { name: n }),
    onSuccess: () => {
      setActionMsg('已移除');
      qc.invalidateQueries({ queryKey: ['claude', 'mcp', 'list'] });
    },
    onError: (e: Error) => setActionErr(e.message),
  });

  const [presetScope, setPresetScope] = useState<Scope>('project');

  const renderInstalled = (label: string, list: string[] | undefined) =>
    list && list.length > 0 ? (
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <ul className="space-y-1">
          {list.map((n) => (
            <li key={`${label}-${n}`} className="flex items-center justify-between rounded border border-border px-2 py-1 text-sm">
              <code>{n}</code>
              <Button size="sm" variant="outline" onClick={() => remove.mutate(n)}>
                移除
              </Button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>预置 MCP</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>安装作用域</span>
            <Select value={presetScope} onValueChange={(v) => setPresetScope(v as Scope)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <div className="text-xs text-destructive">{(error as Error).message}</div> : null}
          {isLoading ? <div className="text-xs text-muted-foreground">加载中...</div> : null}
          <div className="space-y-2">
            {(data?.supported ?? []).map((p) => {
              const installedAny = p.installedLocal || p.installedProject || p.installedUser;
              return (
                <div key={p.name} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.description}</div>
                    <div className="text-xs text-muted-foreground">
                      local: {p.installedLocal ? '✓' : '–'} | project: {p.installedProject ? '✓' : '–'} | user: {p.installedUser ? '✓' : '–'}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setActionErr('');
                        setActionMsg('');
                        presetInstall.mutate({ name: p.name, scope: presetScope });
                      }}
                      disabled={presetInstall.isPending}
                    >
                      安装
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setActionErr('');
                        setActionMsg('');
                        presetRemove.mutate({ name: p.name, scope: 'all' });
                      }}
                      disabled={!installedAny || presetRemove.isPending}
                    >
                      卸载
                    </Button>
                  </div>
                </div>
              );
            })}
            {(data?.supported ?? []).length === 0 && !isLoading ? (
              <div className="text-xs text-muted-foreground">无预置 MCP</div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>已安装 MCP</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {renderInstalled('local', data?.installed.local)}
          {renderInstalled('project', data?.installed.project)}
          {renderInstalled('user', data?.installed.user)}
          {!data?.installed?.local?.length && !data?.installed?.project?.length && !data?.installed?.user?.length ? (
            <div className="text-xs text-muted-foreground">暂无已安装 MCP</div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>手动添加 MCP</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>transport</Label>
              <Select value={transport} onValueChange={setTransport}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">http</SelectItem>
                  <SelectItem value="sse">sse</SelectItem>
                  <SelectItem value="stdio">stdio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>target</Label>
              <Input value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
          </div>
          <Button
            onClick={() => {
              setActionErr('');
              setActionMsg('');
              add.mutate();
            }}
            disabled={!name || !target || add.isPending}
          >
            {add.isPending ? '添加中...' : '添加'}
          </Button>
          {actionMsg ? <div className="text-xs text-green-500">{actionMsg}</div> : null}
          {actionErr ? <div className="text-xs text-destructive">{actionErr}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
