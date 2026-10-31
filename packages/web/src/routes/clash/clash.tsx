import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';
import { type ClashProxy, ProxyDialog } from './proxy-dialog';

type ClashResourceGroup = 'list' | 'icon';
const RESOURCE_GROUPS: ClashResourceGroup[] = ['list', 'icon'];
const GROUP_LABELS: Record<ClashResourceGroup, string> = {
  list: 'list (规则/订阅)',
  icon: 'icon (分组图标)',
};

type RuleBehavior = 'classical' | 'domain' | 'ipcidr';

interface ClashCustomRule {
  id: string;
  name: string;
  target_group: string;
  behavior: RuleBehavior;
  rules: string[];
  enabled: boolean;
}

interface ClashConfig {
  api_key?: string;
  clash_public_base_url?: string;
  qx_public_base_url?: string;
  custom_proxies: ClashProxy[];
  custom_rules: ClashCustomRule[];
}

interface PublicBaseUrls {
  clash: string;
  qx: string;
}

interface ClashResource {
  url: string;
  filename: string;
  source: 'remote' | 'manual' | 'local';
  size?: number;
  updatedAt?: number;
  error?: string;
}
type ClashManifest = Record<ClashResourceGroup, ClashResource[]>;

interface QxReport {
  stats: { nodes: number; groups: number; rules: number; skippedNodes: number; skippedRules: number };
  issues: { code: string; message: string; count: number }[];
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

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function ClashTab() {
  const qc = useQueryClient();
  const toast = useToast();

  const qxReport = useMutation({
    mutationFn: () => apiGet<QxReport>('/api/clash/quantumultx/report'),
    onError: (error: Error) => toast.error(error.message),
  });

  const configQuery = useQuery<ClashConfig>({
    queryKey: ['clash', 'config'],
    queryFn: () => apiGet<ClashConfig>('/api/clash/config'),
  });
  const templateQuery = useQuery<{ content: string }>({
    queryKey: ['clash', 'template'],
    queryFn: () => apiGet('/api/clash/template'),
  });
  const manifestQuery = useQuery<ClashManifest>({
    queryKey: ['clash', 'resources'],
    queryFn: () => apiGet('/api/clash/resources'),
  });
  const groupsQuery = useQuery<{ groups: string[] }>({
    queryKey: ['clash', 'groups'],
    queryFn: () => apiGet('/api/clash/groups'),
  });

  const cfg = configQuery.data;
  const groupNames = groupsQuery.data?.groups ?? [];

  const [draft, setDraft] = useState<string | null>(null);
  const content = draft ?? templateQuery.data?.content ?? '';

  const [proxyDialogOpen, setProxyDialogOpen] = useState(false);
  const [editingProxy, setEditingProxy] = useState<ClashProxy | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ClashCustomRule | null>(null);

  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const refreshKey = (g: ClashResourceGroup, url: string) => `${g}:${url}`;

  const saveTemplate = useMutation({
    mutationFn: (text: string) => apiPut('/api/clash/template', { content: text }),
    onSuccess: () => {
      toast.success('YAML 模板已保存，资源开始后台下载');
      setDraft(null);
      qxReport.reset();
      qc.invalidateQueries({ queryKey: ['clash', 'template'] });
      qc.invalidateQueries({ queryKey: ['clash', 'resources'] });
      qc.invalidateQueries({ queryKey: ['clash', 'groups'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveConfig = useMutation({
    mutationFn: (next: ClashConfig) => apiPut('/api/clash/config', next),
    onSuccess: () => {
      toast.success('已保存');
      qxReport.reset();
      qc.invalidateQueries({ queryKey: ['clash', 'config'] });
      qc.invalidateQueries({ queryKey: ['clash', 'resources'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rotateKey = useMutation({
    mutationFn: () => apiPost('/api/clash/subscribe/rotate-key'),
    onSuccess: async () => {
      toast.success('订阅密钥已轮换');
      await qc.invalidateQueries({ queryKey: ['clash', 'config'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveKey = useMutation({
    mutationFn: (apiKey: string) => {
      const current = cfg ?? { custom_proxies: [], custom_rules: [] };
      return apiPut('/api/clash/config', { ...current, api_key: apiKey });
    },
    onSuccess: async () => {
      toast.success('订阅密钥已更新');
      await qc.invalidateQueries({ queryKey: ['clash', 'config'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveBaseUrls = useMutation({
    mutationFn: (bases: PublicBaseUrls) => {
      const current = cfg ?? { custom_proxies: [], custom_rules: [] };
      const next: ClashConfig = {
        ...current,
        clash_public_base_url: bases.clash || undefined,
        qx_public_base_url: bases.qx || undefined,
      };
      return apiPut('/api/clash/config', next);
    },
    onSuccess: async () => {
      toast.success('公网地址已保存');
      await qc.invalidateQueries({ queryKey: ['clash', 'config'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addResource = useMutation({
    mutationFn: (body: { group: ClashResourceGroup; url: string }) =>
      apiPost('/api/clash/resources/add', body),
    onSuccess: (_d, vars) => {
      toast.success('已新增资源，开始下载…');
      qc.invalidateQueries({ queryKey: ['clash', 'resources'] });
      refreshOne(vars.group, vars.url);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeResource = useMutation({
    mutationFn: (body: { group: ClashResourceGroup; filename: string }) =>
      apiDelete('/api/clash/resources', body),
    onSuccess: () => {
      toast.success('已删除资源');
      qc.invalidateQueries({ queryKey: ['clash', 'resources'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function refreshOne(group: ClashResourceGroup, url: string): Promise<void> {
    const key = refreshKey(group, url);
    setRefreshing((s) => new Set(s).add(key));
    try {
      await apiPost('/api/clash/resources/refresh', { group, url });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
      qc.invalidateQueries({ queryKey: ['clash', 'resources'] });
    }
  }

  async function refreshAll(group?: ClashResourceGroup): Promise<void> {
    const manifest = manifestQuery.data;
    if (!manifest) return;
    const groups: ClashResourceGroup[] = group ? [group] : RESOURCE_GROUPS;
    const tasks: { group: ClashResourceGroup; url: string }[] = [];
    for (const g of groups) {
      for (const e of manifest[g]) {
        if (e.source === 'local') continue;
        tasks.push({ group: g, url: e.url });
      }
    }
    if (tasks.length === 0) return;
    setRefreshing((s) => {
      const next = new Set(s);
      for (const t of tasks) next.add(refreshKey(t.group, t.url));
      return next;
    });
    await Promise.all(tasks.map((t) => refreshOne(t.group, t.url)));
    toast.success(group ? `${group} 已刷新` : '全部资源已刷新');
  }

  const subscribeUrls = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3333';
    const key = cfg?.api_key;
    const query = key ? `?api-key=${encodeURIComponent(key)}` : '';
    const clashBase = cfg?.clash_public_base_url?.trim().replace(/\/+$/, '') || origin;
    const qxBase = cfg?.qx_public_base_url?.trim().replace(/\/+$/, '') || origin;
    return {
      clash: `${clashBase}/api/clash/subscribe${query}`,
      qx: `${qxBase}/api/qx/subscribe${query}`,
    };
  }, [cfg?.api_key, cfg?.clash_public_base_url, cfg?.qx_public_base_url]);

  const anyRefreshing = refreshing.size > 0;

  const handleProxySubmit = (p: ClashProxy) => {
    if (!cfg) return;
    const existing = cfg.custom_proxies ?? [];
    const updated = editingProxy
      ? existing.map((x) => (x.name === editingProxy.name ? p : x))
      : [...existing, p];
    saveConfig.mutate({ ...cfg, custom_proxies: updated });
    setProxyDialogOpen(false);
    setEditingProxy(null);
  };
  const handleDeleteProxy = (name: string) => {
    if (!cfg) return;
    saveConfig.mutate({ ...cfg, custom_proxies: cfg.custom_proxies.filter((p) => p.name !== name) });
  };

  const handleRuleSubmit = (rs: ClashCustomRule) => {
    if (!cfg) return;
    const existing = cfg.custom_rules ?? [];
    const updated = editingRule
      ? existing.map((x) => (x.id === editingRule.id ? rs : x))
      : [...existing, rs];
    saveConfig.mutate({ ...cfg, custom_rules: updated });
    setRuleDialogOpen(false);
    setEditingRule(null);
  };
  const handleDeleteRule = (id: string) => {
    if (!cfg) return;
    saveConfig.mutate({ ...cfg, custom_rules: cfg.custom_rules.filter((r) => r.id !== id) });
  };
  const handleMoveRule = (index: number, dir: -1 | 1) => {
    if (!cfg) return;
    const list = [...cfg.custom_rules];
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const tmp = list[index]!;
    list[index] = list[target]!;
    list[target] = tmp;
    saveConfig.mutate({ ...cfg, custom_rules: list });
  };
  const handleToggleRule = (id: string) => {
    if (!cfg) return;
    const list = cfg.custom_rules.map((r) =>
      r.id === id ? { ...r, enabled: !r.enabled } : r,
    );
    saveConfig.mutate({ ...cfg, custom_rules: list });
  };

  return (
    <div className="space-y-4">
      <SubscribeCard
        subscribeUrl={subscribeUrls.clash}
        qxSubscribeUrl={subscribeUrls.qx}
        hasKey={!!cfg?.api_key}
        onRotate={() => rotateKey.mutate()}
        rotating={rotateKey.isPending}
        onSaveKey={(key) => saveKey.mutateAsync(key)}
        savingKey={saveKey.isPending || saveBaseUrls.isPending || !cfg}
        clashBaseUrl={cfg?.clash_public_base_url ?? ''}
        qxBaseUrl={cfg?.qx_public_base_url ?? ''}
        onSaveBaseUrls={(bases) => saveBaseUrls.mutateAsync(bases)}
        savingBaseUrls={saveBaseUrls.isPending || saveKey.isPending || rotateKey.isPending || !cfg}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Quantumult X 转换</CardTitle>
            <p className="text-xs text-muted-foreground">使用当前已保存的 Clash 配置生成，仅包含节点、策略和分流。</p>
          </div>
          <Button size="sm" variant="outline" disabled={qxReport.isPending} onClick={() => qxReport.mutate()}>
            {qxReport.isPending ? '检查中…' : '检查转换'}
          </Button>
        </CardHeader>
        {qxReport.data ? (
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{qxReport.data.stats.nodes} 个节点</Badge>
              <Badge variant="secondary">{qxReport.data.stats.groups} 个策略组</Badge>
              <Badge variant="secondary">{qxReport.data.stats.rules} 条规则</Badge>
              {qxReport.data.stats.skippedNodes > 0 ? <Badge variant="outline">跳过 {qxReport.data.stats.skippedNodes} 个节点</Badge> : null}
              {qxReport.data.stats.skippedRules > 0 ? <Badge variant="outline">跳过 {qxReport.data.stats.skippedRules} 条规则</Badge> : null}
            </div>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {qxReport.data.issues.map(issue => (
                <li key={issue.code}>{issue.message}{issue.count > 1 ? '（' + issue.count + ' 项）' : ''}</li>
              ))}
            </ul>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>YAML 模板 (clash 订阅基础配置)</CardTitle>
          <div className="flex gap-2">
            {draft !== null && (
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>取消</Button>
            )}
            <Button
              size="sm"
              disabled={saveTemplate.isPending || draft === null}
              onClick={() => saveTemplate.mutate(content)}
            >
              {saveTemplate.isPending ? '保存中…' : '保存'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <textarea
            className="h-[480px] w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed outline-none focus:border-primary"
            value={content}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            placeholder="# 粘贴 Clash YAML（包含 proxy-providers / proxy-groups / rule-providers / rules）..."
          />
          <p className="mt-2 text-xs text-muted-foreground">
            保存后下载规则集和分组图标。Clash 订阅保留机场直连地址；QX 订阅由服务端读取机场节点并缓存，再按当前配置自动生成。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>自定义节点</span>
            <Button size="sm" onClick={() => { setEditingProxy(null); setProxyDialogOpen(true); }}>+ 新增节点</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(cfg?.custom_proxies ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无自定义节点。</div>
          ) : (cfg?.custom_proxies ?? []).map((p) => (
            <div key={p.name} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="font-medium">{p.name}</span>
                {p.type ? <Badge variant="secondary" className="text-xs">{String(p.type)}</Badge> : null}
                {p.server && p.port ? <span className="font-mono text-xs text-muted-foreground">{String(p.server)}:{String(p.port)}</span> : null}
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => { setEditingProxy(p); setProxyDialogOpen(true); }}>编辑</Button>
                <Button size="sm" variant="destructive" onClick={() => { if (window.confirm(`删除节点 "${p.name}"?`)) handleDeleteProxy(p.name); }}>删除</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>自定义规则 (置顶注入)</span>
            <Button size="sm" disabled={groupNames.length === 0} onClick={() => { setEditingRule(null); setRuleDialogOpen(true); }}>
              + 新增规则
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {groupNames.length === 0 ? (
            <div className="text-xs text-muted-foreground">请先保存包含 proxy-groups 的 YAML 模板，才能添加规则。</div>
          ) : null}
          {(cfg?.custom_rules ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无自定义规则。</div>
          ) : (cfg?.custom_rules ?? []).map((r, idx) => (
            <div key={r.id} className={cn('flex items-center justify-between gap-3 rounded-md border border-border p-3', !r.enabled && 'opacity-50')}>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="font-medium">{r.name}</span>
                <Badge variant="secondary" className="text-xs">{r.behavior}</Badge>
                <span className="text-xs text-muted-foreground">→ {r.target_group}</span>
                <span className="text-xs text-muted-foreground">({r.rules.length} 条)</span>
                <span className="font-mono text-[10px] text-muted-foreground">custom-{r.id}.list</span>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" disabled={idx === 0} onClick={() => handleMoveRule(idx, -1)}>↑</Button>
                <Button size="sm" variant="ghost" disabled={idx === (cfg?.custom_rules.length ?? 0) - 1} onClick={() => handleMoveRule(idx, 1)}>↓</Button>
                <Button size="sm" variant="outline" onClick={() => handleToggleRule(r.id)}>{r.enabled ? '停用' : '启用'}</Button>
                <Button size="sm" variant="outline" onClick={() => { setEditingRule(r); setRuleDialogOpen(true); }}>编辑</Button>
                <Button size="sm" variant="destructive" onClick={() => { if (window.confirm(`删除规则 "${r.name}"?`)) handleDeleteRule(r.id); }}>删除</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">远程资源</h2>
        <Button variant="outline" size="sm" disabled={anyRefreshing} onClick={() => refreshAll()}>
          {anyRefreshing ? `刷新中… (${refreshing.size})` : '全量刷新'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        系统内置规则自动刷新：启动时及每 5 分钟检查，按模板 interval 更新（默认 24 小时），失败保留旧内容。定时刷新只更新规则，“全量刷新”还会更新图标。
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {RESOURCE_GROUPS.map((g) => (
          <ResourceGroup
            key={g}
            group={g}
            apiKey={cfg?.api_key}
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

      <ProxyDialog
        open={proxyDialogOpen}
        onOpenChange={setProxyDialogOpen}
        initial={editingProxy}
        onSubmit={handleProxySubmit}
      />
      <RuleDialog
        open={ruleDialogOpen}
        onOpenChange={setRuleDialogOpen}
        initial={editingRule}
        groupNames={groupNames}
        onSubmit={handleRuleSubmit}
      />
    </div>
  );
}

function SubscribeCard({
  subscribeUrl,
  qxSubscribeUrl,
  hasKey,
  onRotate,
  rotating,
  onSaveKey,
  savingKey,
  clashBaseUrl,
  qxBaseUrl,
  onSaveBaseUrls,
  savingBaseUrls,
}: {
  subscribeUrl: string;
  qxSubscribeUrl: string;
  hasKey: boolean;
  onRotate: () => void;
  rotating: boolean;
  onSaveKey: (key: string) => Promise<unknown>;
  savingKey: boolean;
  clashBaseUrl: string;
  qxBaseUrl: string;
  onSaveBaseUrls: (bases: PublicBaseUrls) => Promise<unknown>;
  savingBaseUrls: boolean;
}) {
  const toast = useToast();
  const [keyDraft, setKeyDraft] = useState('');
  const [baseDraft, setBaseDraft] = useState<PublicBaseUrls | null>(null);
  const baseValues = baseDraft ?? { clash: clashBaseUrl, qx: qxBaseUrl };
  return (
    <Card>
      <CardHeader>
        <CardTitle>订阅地址</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {[
          { label: 'Clash', url: subscribeUrl },
          { label: 'Quantumult X', url: qxSubscribeUrl },
        ].map(entry => (
          <div key={entry.label} className="space-y-1">
            <Label className="text-xs text-muted-foreground">{entry.label}</Label>
            <div className="flex items-center gap-2">
              <Input aria-label={entry.label + ' 订阅地址'} value={entry.url} readOnly className="font-mono text-xs" />
              <Button size="sm" variant="outline" onClick={() => {
                navigator.clipboard.writeText(entry.url).then(
                  () => toast.success('已复制'),
                  () => toast.error('复制失败'),
                );
              }}>复制</Button>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">两种订阅共用 Clash 配置和密钥。QX 不包含重写、脚本或 MITM。</p>
          <Button size="sm" variant="outline" onClick={onRotate} disabled={rotating || savingKey}>
            {hasKey ? '轮换密钥' : '生成密钥'}
          </Button>
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={async (event) => {
            event.preventDefault();
            const key = keyDraft.trim();
            if (!key || savingKey || rotating) return;
            try {
              await onSaveKey(key);
              setKeyDraft('');
            } catch {
              // The mutation displays the error; preserve the draft for retry.
            }
          }}
        >
          <Label htmlFor="subscription-api-key" className="shrink-0 text-xs text-muted-foreground sm:w-36">手动设置密钥</Label>
          <Input
            id="subscription-api-key"
            type="password"
            autoComplete="new-password"
            placeholder="输入新密钥"
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
            disabled={savingKey || rotating}
            className="min-w-0 font-mono text-xs"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!keyDraft.trim() || savingKey || rotating}>保存密钥</Button>
        </form>
        <p className="text-xs text-muted-foreground">手动修改或轮换密钥后，请将新的订阅地址更新到客户端。</p>
        {([
          { key: 'clash', label: 'Clash 公网地址' },
          { key: 'qx', label: 'Quantumult X 公网地址' },
        ] as const).map(entry => (
          <div key={entry.key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Label htmlFor={`${entry.key}-public-base-url`} className="shrink-0 text-xs text-muted-foreground sm:w-36">{entry.label}</Label>
            <Input
              id={`${entry.key}-public-base-url`}
              value={baseValues[entry.key]}
              onChange={(e) => setBaseDraft({ ...baseValues, [entry.key]: e.target.value })}
              placeholder="http://127.0.0.1:3333"
              className="min-w-0 font-mono text-xs"
            />
          </div>
        ))}
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={savingBaseUrls || baseDraft === null}
            onClick={async () => {
              try {
                await onSaveBaseUrls({ clash: baseValues.clash.trim(), qx: baseValues.qx.trim() });
                setBaseDraft(null);
              } catch {
                // The mutation displays the error; preserve the draft for retry.
              }
            }}
          >
            保存公网地址
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          分别填写 Clash 和 Quantumult X 客户端可访问的服务地址；修改后请在客户端更新订阅。
        </p>
      </CardContent>
    </Card>
  );
}

function LocalLink({ group, filename, downloaded, apiKey }: { group: ClashResourceGroup; filename: string; downloaded: boolean; apiKey?: string }) {
  const toast = useToast();
  const prefix = group === 'icon' ? '/api/static/icon/' : '/api/clash/static/list/';
  const localPath = prefix + encodeURIComponent(filename) + (apiKey ? '?api-key=' + encodeURIComponent(apiKey) : '');
  const fullUrl = typeof window !== 'undefined' ? `${window.location.origin}${localPath}` : localPath;
  if (!downloaded) {
    return <div className="text-[10px] text-muted-foreground/70">本地: 未下载</div>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <a href={localPath} target="_blank" rel="noreferrer" className="truncate text-[11px] text-foreground hover:underline" title={fullUrl}>
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
  apiKey,
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
  group: ClashResourceGroup;
  apiKey?: string;
  entries: ClashResource[];
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
  const localCount = entries.filter((e) => e.source === 'local').length;
  const groupRefreshing = entries.some((e) => refreshing.has(`${group}:${e.url}`));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{GROUP_LABELS[group]}</CardTitle>
          <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">remote {remoteCount}</Badge>
            <Badge variant="outline">manual {manualCount}</Badge>
            {localCount > 0 ? <Badge variant="outline">local {localCount}</Badge> : null}
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
                      <Badge variant={e.source === 'manual' ? 'default' : 'outline'} className="shrink-0 px-1 py-0 text-[10px]">{e.source}</Badge>
                      <span className="min-w-0 flex-1 truncate font-mono">{e.filename}</span>
                    </div>
                    <div className="truncate text-muted-foreground" title={e.url}>源: {e.url}</div>
                    <LocalLink group={group} filename={e.filename} downloaded={e.source === 'local' || !!e.updatedAt} apiKey={apiKey} />
                    <div className="text-[10px] text-muted-foreground/80">
                      {fmtBytes(e.size)} · {fmtTime(e.updatedAt)}
                      {e.error && <span className="ml-2 text-destructive">{e.error}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {e.source !== 'local' ? (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={isRefreshing} onClick={() => onRefreshOne(e.url)}>
                        {isRefreshing ? '刷新中' : '刷新'}
                      </Button>
                    ) : null}
                    {e.source !== 'local' ? (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-destructive" disabled={removing || isRefreshing} onClick={() => onRemove(e.filename)}>
                        删除
                      </Button>
                    ) : null}
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

const RULE_TYPES = ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'IP-CIDR6', 'GEOIP', 'PROCESS-NAME'] as const;
const BEHAVIORS: RuleBehavior[] = ['classical', 'domain', 'ipcidr'];

function RuleDialog({
  open,
  onOpenChange,
  initial,
  groupNames,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: ClashCustomRule | null;
  groupNames: string[];
  onSubmit: (r: ClashCustomRule) => void;
}) {
  const [name, setName] = useState('');
  const [behavior, setBehavior] = useState<RuleBehavior>('classical');
  const [targetGroup, setTargetGroup] = useState('');
  const [rulesText, setRulesText] = useState('');
  const [showTypePicker, setShowTypePicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setBehavior(initial?.behavior ?? 'classical');
      setTargetGroup(initial?.target_group ?? groupNames[0] ?? '');
      setRulesText((initial?.rules ?? []).join('\n'));
      setShowTypePicker(false);
    }
  }, [open, initial, groupNames]);

  const insertType = (t: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const newText = rulesText.slice(0, pos) + t + ',' + rulesText.slice(pos);
    setRulesText(newText);
    setShowTypePicker(false);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(pos + t.length + 1, pos + t.length + 1);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') setShowTypePicker(true);
    else setShowTypePicker(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rules = rulesText.split('\n').map((l) => l.trim()).filter(Boolean);
    onSubmit({
      id: initial?.id ?? randomId(),
      name,
      behavior,
      target_group: targetGroup,
      rules,
      enabled: initial?.enabled ?? true,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? '编辑规则' : '新增规则'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="MyRules" required />
            </div>
            <div className="space-y-1.5">
              <Label>目标分组</Label>
              <select
                value={targetGroup}
                onChange={(e) => setTargetGroup(e.target.value)}
                required
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {groupNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Behavior</Label>
            <select
              value={behavior}
              onChange={(e) => setBehavior(e.target.value as RuleBehavior)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {BEHAVIORS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>规则 (每行一条，例如 DOMAIN-SUFFIX,google.com)</Label>
            <textarea
              ref={textareaRef}
              value={rulesText}
              onChange={(e) => setRulesText(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              rows={12}
              className="w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={'DOMAIN-SUFFIX,google.com\nDOMAIN,youtube.com\nIP-CIDR,8.8.8.8/32'}
            />
            {showTypePicker ? (
              <div className="flex flex-wrap gap-1.5 rounded-md border border-primary/30 bg-card p-2">
                <span className="w-full text-[10px] text-muted-foreground">Insert type:</span>
                {RULE_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); insertType(t); }}
                    className="rounded border border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px] hover:border-primary hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="text-[10px] text-muted-foreground">保存后这些规则会作为本地 .list 文件，并以 rule-provider 形式插到订阅 rules 顶部。</p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
