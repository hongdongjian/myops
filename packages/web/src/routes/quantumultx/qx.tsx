import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

type QxGroup = 'general' | 'task_local' | 'rewrite_remote' | 'http_backend' | 'filter_remote' | 'server_remote' | 'images';
const GROUPS: QxGroup[] = ['general', 'task_local', 'rewrite_remote', 'http_backend', 'filter_remote', 'server_remote', 'images'];
const GROUP_LABELS: Record<QxGroup, string> = {
  general: 'general (脚本/资源)',
  task_local: 'task_local',
  rewrite_remote: 'rewrite_remote',
  http_backend: 'http_backend',
  filter_remote: 'filter_remote (规则订阅)',
  server_remote: 'server_remote (节点订阅)',
  images: 'images (img-url)',
};

interface QxResource {
  url: string;
  filename: string;
  source: 'remote' | 'manual';
  size?: number;
  updatedAt?: number;
  error?: string;
}
type QxManifest = Record<QxGroup, QxResource[]>;
interface QxConfig {
  api_key?: string;
  public_base_url?: string;
}

const apiPut = (path: string, body: unknown) =>
  api(path, { method: 'PUT', body: JSON.stringify(body) });
const apiDelete = (path: string, body: unknown) =>
  api(path, { method: 'DELETE', body: JSON.stringify(body) });

function fmtTime(ts?: number): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

function fmtBytes(n?: number): string {
  if (n === undefined) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function QxTab() {
  const qc = useQueryClient();
  const toast = useToast();

  const confQuery = useQuery<{ content: string }>({
    queryKey: ['qx', 'conf'],
    queryFn: () => apiGet('/api/qx/conf'),
  });
  const manifestQuery = useQuery<QxManifest>({
    queryKey: ['qx', 'resources'],
    queryFn: () => apiGet('/api/qx/resources'),
  });
  const configQuery = useQuery<QxConfig>({
    queryKey: ['qx', 'config'],
    queryFn: () => apiGet('/api/qx/config'),
  });

  const [draft, setDraft] = useState<string | null>(null);
  const content = draft ?? confQuery.data?.content ?? '';

  // Track per-URL refresh state: key = `${group}:${url}`
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const refreshKey = (g: QxGroup, url: string) => `${g}:${url}`;

  async function refreshOne(group: QxGroup, url: string): Promise<void> {
    const key = refreshKey(group, url);
    setRefreshing((s) => new Set(s).add(key));
    try {
      await apiPost('/api/qx/resources/refresh', { group, url });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
      qc.invalidateQueries({ queryKey: ['qx', 'resources'] });
    }
  }

  async function refreshAll(group?: QxGroup) {
    // Snapshot current entries from cache; mark all as refreshing immediately
    const manifest = manifestQuery.data;
    if (!manifest) return;
    const groups: QxGroup[] = group ? [group] : GROUPS;
    const tasks: { group: QxGroup; url: string }[] = [];
    for (const g of groups) for (const e of manifest[g]) tasks.push({ group: g, url: e.url });
    if (tasks.length === 0) return;

    setRefreshing((s) => {
      const next = new Set(s);
      for (const t of tasks) next.add(refreshKey(t.group, t.url));
      return next;
    });

    await Promise.all(tasks.map((t) => refreshOne(t.group, t.url)));
    toast.success(group ? `${group} 已刷新` : '全部资源已刷新');
  }

  const saveConf = useMutation({
    mutationFn: (text: string) => apiPut('/api/qx/conf', { content: text }),
    onSuccess: () => {
      toast.success('配置已保存，资源开始后台下载');
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['qx', 'conf'] });
      qc.invalidateQueries({ queryKey: ['qx', 'resources'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addResource = useMutation({
    mutationFn: (body: { group: QxGroup; url: string }) =>
      apiPost('/api/qx/resources/add', body),
    onSuccess: (_data, vars) => {
      toast.success('已新增资源，开始下载…');
      qc.invalidateQueries({ queryKey: ['qx', 'resources'] });
      refreshOne(vars.group, vars.url);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeResource = useMutation({
    mutationFn: (body: { group: QxGroup; filename: string }) =>
      apiDelete('/api/qx/resources', body),
    onSuccess: () => {
      toast.success('已删除资源');
      qc.invalidateQueries({ queryKey: ['qx', 'resources'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rotateKey = useMutation({
    mutationFn: () => apiPost('/api/qx/subscribe/rotate-key'),
    onSuccess: () => {
      toast.success('订阅密钥已轮换');
      qc.invalidateQueries({ queryKey: ['qx', 'config'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveBaseUrl = useMutation({
    mutationFn: (base: string) => {
      const current = configQuery.data ?? {};
      return apiPut('/api/qx/config', { ...current, public_base_url: base || undefined });
    },
    onSuccess: () => {
      toast.success('公网地址已保存');
      qc.invalidateQueries({ queryKey: ['qx', 'config'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const subscribeUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3333';
    const key = configQuery.data?.api_key;
    return key ? `${origin}/api/qx/subscribe?api-key=${key}` : `${origin}/api/qx/subscribe`;
  }, [configQuery.data?.api_key]);

  const anyRefreshing = refreshing.size > 0;

  return (
    <div className="space-y-4">
      <SubscribeCard
        subscribeUrl={subscribeUrl}
        hasKey={!!configQuery.data?.api_key}
        onRotate={() => rotateKey.mutate()}
        rotating={rotateKey.isPending}
        baseUrl={configQuery.data?.public_base_url ?? ''}
        onSaveBaseUrl={(b) => saveBaseUrl.mutate(b)}
        savingBaseUrl={saveBaseUrl.isPending}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>配置文件 (QuantumultX.conf)</CardTitle>
          <div className="flex gap-2">
            {draft !== null && (
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                取消
              </Button>
            )}
            <Button
              size="sm"
              disabled={saveConf.isPending || (draft === null)}
              onClick={() => saveConf.mutate(content)}
            >
              {saveConf.isPending ? '保存中…' : '保存'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <textarea
            className="h-[480px] w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed outline-none focus:border-primary"
            value={content}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            placeholder="# 粘贴或编辑 QuantumultX 配置..."
          />
          <p className="mt-2 text-xs text-muted-foreground">
            保存后会自动解析 task_local / rewrite_remote / http_backend 中的远程 URL 与 img-url 图片。
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">远程资源</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={anyRefreshing}
          onClick={() => refreshAll()}
        >
          {anyRefreshing ? `刷新中… (${refreshing.size})` : '全量刷新'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <ResourceGroup
            key={g}
            group={g}
            entries={manifestQuery.data?.[g] ?? []}
            refreshing={refreshing}
            anyRefreshing={anyRefreshing}
            onRefreshGroup={() => refreshAll(g)}
            onRefreshOne={(url) => refreshOne(g, url)}
            onAdd={(url) => addResource.mutate({ group: g, url })}
            onRemove={(filename) => removeResource.mutate({ group: g, filename })}
            adding={addResource.isPending}
            removing={removeResource.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function SubscribeCard({
  subscribeUrl,
  hasKey,
  onRotate,
  rotating,
  baseUrl,
  onSaveBaseUrl,
  savingBaseUrl,
}: {
  subscribeUrl: string;
  hasKey: boolean;
  onRotate: () => void;
  rotating: boolean;
  baseUrl: string;
  onSaveBaseUrl: (b: string) => void;
  savingBaseUrl: boolean;
}) {
  const toast = useToast();
  const [baseDraft, setBaseDraft] = useState<string | null>(null);
  const baseValue = baseDraft ?? baseUrl;
  return (
    <Card>
      <CardHeader>
        <CardTitle>订阅地址</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input value={subscribeUrl} readOnly className="font-mono text-xs" />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(subscribeUrl).then(
                  () => toast.success('已复制'),
                  () => toast.error('复制失败'),
                );
              }}
            >
              复制
            </Button>
            <Button size="sm" variant="outline" onClick={onRotate} disabled={rotating}>
              {hasKey ? '轮换密钥' : '生成密钥'}
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Label className="shrink-0 text-xs text-muted-foreground">公网地址</Label>
          <Input
            value={baseValue}
            onChange={(e) => setBaseDraft(e.target.value)}
            placeholder="http://127.0.0.1:3333 (留空使用此默认)"
            className="font-mono text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={savingBaseUrl || baseDraft === null}
            onClick={() => {
              onSaveBaseUrl(baseValue.trim());
              setBaseDraft(null);
            }}
          >
            保存
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          上方的订阅地址是本服务的访问入口（始终为当前站点），公网地址用于订阅文件内资源 URL 的替换（不填默认 http://127.0.0.1:3333）。下载资源若需走代理，请通过 HTTPS_PROXY / HTTP_PROXY 环境变量设置（仅支持 http://，不支持 socks）。
        </p>
      </CardContent>
    </Card>
  );
}

function LocalLink({ group, filename, downloaded }: { group: QxGroup; filename: string; downloaded: boolean }) {
  const toast = useToast();
  const localPath = `/api/qx/static/${group}/${encodeURIComponent(filename)}`;
  const fullUrl = typeof window !== 'undefined' ? `${window.location.origin}${localPath}` : localPath;
  if (!downloaded) {
    return <div className="text-[10px] text-muted-foreground/70">本地: 未下载</div>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <a
        href={localPath}
        target="_blank"
        rel="noreferrer"
        className="truncate text-[11px] text-foreground hover:underline"
        title={fullUrl}
      >
        本地: {fullUrl}
      </a>
      <button
        type="button"
        className="text-[10px] text-muted-foreground hover:text-foreground"
        onClick={(ev) => {
          ev.preventDefault();
          navigator.clipboard.writeText(fullUrl).then(
            () => toast.success('已复制本地地址'),
            () => toast.error('复制失败'),
          );
        }}
      >
        [复制]
      </button>
    </div>
  );
}

function ResourceGroup({
  group,
  entries,
  refreshing,
  anyRefreshing,
  onRefreshGroup,
  onRefreshOne,
  onAdd,
  onRemove,
  adding,
  removing,
}: {
  group: QxGroup;
  entries: QxResource[];
  refreshing: Set<string>;
  anyRefreshing: boolean;
  onRefreshGroup: () => void;
  onRefreshOne: (url: string) => void;
  onAdd: (url: string) => void;
  onRemove: (filename: string) => void;
  adding: boolean;
  removing: boolean;
}) {
  const [newUrl, setNewUrl] = useState('');
  const remoteCount = entries.filter((e) => e.source === 'remote').length;
  const manualCount = entries.filter((e) => e.source === 'manual').length;
  const groupRefreshing = entries.some((e) => refreshing.has(`${group}:${e.url}`));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{GROUP_LABELS[group]}</CardTitle>
          <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">remote {remoteCount}</Badge>
            <Badge variant="outline">manual {manualCount}</Badge>
          </div>
        </div>
        <Button size="sm" variant="outline" disabled={anyRefreshing} onClick={onRefreshGroup}>
          {groupRefreshing ? '刷新中…' : '刷新本组'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="新增资源 URL (https://...)"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            className="text-xs"
          />
          <Button
            size="sm"
            disabled={adding || !newUrl.trim()}
            onClick={() => {
              onAdd(newUrl.trim());
              setNewUrl('');
            }}
          >
            新增
          </Button>
        </div>

        {entries.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">暂无资源</p>
        ) : (
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {entries.map((e) => {
              const isRefreshing = refreshing.has(`${group}:${e.url}`);
              return (
                <div
                  key={e.filename}
                  className={cn(
                    'flex items-start justify-between gap-2 rounded-md border border-border bg-background/40 p-2 text-xs',
                    e.error && 'border-destructive/60',
                  )}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={e.source === 'manual' ? 'default' : 'outline'}
                        className="shrink-0 px-1 py-0 text-[10px]"
                      >
                        {e.source}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate font-mono">{e.filename}</span>
                    </div>
                    <div className="truncate text-muted-foreground" title={e.url}>
                      源: {e.url}
                    </div>
                    <LocalLink group={group} filename={e.filename} downloaded={!!e.updatedAt} />
                    <div className="text-[10px] text-muted-foreground/80">
                      {fmtBytes(e.size)} · {fmtTime(e.updatedAt)}
                      {e.error && <span className="ml-2 text-destructive">{e.error}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px]"
                      disabled={isRefreshing}
                      onClick={() => onRefreshOne(e.url)}
                    >
                      {isRefreshing ? '刷新中' : '刷新'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px] text-destructive"
                      disabled={removing || isRefreshing}
                      onClick={() => onRemove(e.filename)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
