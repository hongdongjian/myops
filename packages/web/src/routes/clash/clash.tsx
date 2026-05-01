import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, api } from '@/lib/api';
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

interface ClashGroup {
  name: string;
  type: string;
  proxies: string[];
  keywords: string[];
  inject_into?: string[];
  url?: string;
  interval?: number;
  timeout?: number;
  tolerance?: number;
  lazy?: boolean;
  max_failed_times?: number;
  strategy?: string;
}

interface ClashRuleSet {
  name: string;
  group: string;
  rules: string[];
  enabled?: boolean;
}

interface ClashConfig {
  subscribe_url: string;
  refresh_interval_minutes: number;
  api_key?: string;
  groups: ClashGroup[];
  rule_sets: ClashRuleSet[];
}

interface UpstreamInfo {
  proxies: string[];
  groups: string[];
  fetchedAt?: number;
}

const GROUP_TYPES = ['select', 'url-test', 'fallback', 'load-balance'] as const;
type GroupType = (typeof GROUP_TYPES)[number];

const LOAD_BALANCE_STRATEGIES = ['round-robin', 'consistent-hashing', 'sticky-sessions'] as const;

const DEFAULT_TEST_URL = 'http://www.gstatic.com/generate_204';

const apiPut = (path: string, body: unknown) =>
  api(path, { method: 'PUT', body: JSON.stringify(body) });

function matchedProxies(group: ClashGroup, upstreamProxies: string[]): string[] {
  if (!group.keywords || group.keywords.length === 0) return group.proxies;
  return upstreamProxies.filter((name) =>
    group.keywords.some((kw) => name.toLowerCase().includes(kw.toLowerCase())),
  );
}

function InfoIcon({ title }: { title: string }) {
  return (
    <span
      title={title}
      className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-border bg-muted text-[10px] text-muted-foreground hover:border-primary hover:text-primary transition-colors"
    >
      ?
    </span>
  );
}

interface GroupDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: ClashGroup | null;
  upstreamGroupNames: string[];
  onSubmit: (g: ClashGroup) => void;
}

function GroupDialog({ open, onOpenChange, initial, upstreamGroupNames, onSubmit }: GroupDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<GroupType>('select');
  const [keywordsText, setKeywordsText] = useState('');
  const [injectInto, setInjectInto] = useState<string[]>([]);
  const [url, setUrl] = useState(DEFAULT_TEST_URL);
  const [interval, setInterval] = useState(300);
  const [timeout, setTimeout] = useState(5000);
  const [tolerance, setTolerance] = useState(150);
  const [lazy, setLazy] = useState(true);
  const [maxFailedTimes, setMaxFailedTimes] = useState(5);
  const [strategy, setStrategy] = useState<string>('round-robin');

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setType((initial?.type as GroupType) ?? 'select');
      setKeywordsText((initial?.keywords ?? []).join(', '));
      setInjectInto(initial?.inject_into ?? []);
      setUrl(initial?.url ?? DEFAULT_TEST_URL);
      setInterval(initial?.interval ?? 300);
      setTimeout(initial?.timeout ?? 5000);
      setTolerance(initial?.tolerance ?? 150);
      setLazy(initial?.lazy ?? true);
      setMaxFailedTimes(initial?.max_failed_times ?? 5);
      setStrategy(initial?.strategy ?? 'round-robin');
    }
  }, [open, initial]);

  const hasHealthCheck = type === 'url-test' || type === 'fallback' || type === 'load-balance';

  const toggleInjectInto = (g: string) =>
    setInjectInto((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const keywords = keywordsText
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const g: ClashGroup = { name, type, proxies: [], keywords, inject_into: injectInto };
    if (hasHealthCheck) {
      g.url = url;
      g.interval = interval;
      g.timeout = timeout;
      g.lazy = lazy;
      g.max_failed_times = maxFailedTimes;
    }
    if (type === 'url-test') g.tolerance = tolerance;
    if (type === 'load-balance') g.strategy = strategy;
    onSubmit(g);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Group' : 'New Group'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="PROXY" required />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <div className="flex flex-wrap gap-1.5">
              {GROUP_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className={cn('rounded-md border px-3 py-1.5 text-xs font-medium transition-all',
                    type === t ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground')}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Keywords (comma-separated)</Label>
            <Input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} placeholder="HK, 香港, US" />
            <p className="text-xs text-muted-foreground">Proxies whose names contain any keyword will be included.</p>
          </div>
          {upstreamGroupNames.length > 0 ? (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                Inject Into <InfoIcon title="选择此分组需要注入的上游 select 代理组。不选则不注入任何上游分组。" />
              </Label>
              <div className="max-h-32 overflow-y-auto rounded-md border border-border bg-muted/20 p-2">
                <div className="flex flex-wrap gap-1.5">
                  {upstreamGroupNames.map((n) => (
                    <button key={n} type="button" onClick={() => toggleInjectInto(n)}
                      className={cn('rounded border px-2 py-0.5 text-xs transition-all',
                        injectInto.includes(n) ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground')}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              {injectInto.length > 0 ? (
                <p className="text-xs text-muted-foreground">已选: {injectInto.join(', ')}</p>
              ) : (
                <p className="text-xs text-muted-foreground">未选择 — 此分组不会注入任何上游 select 组</p>
              )}
            </div>
          ) : null}
          {hasHealthCheck ? (
            <>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  Test URL <InfoIcon title="Health check URL used to test proxy latency/availability." />
                </Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_TEST_URL} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    Interval (s) <InfoIcon title="How often to run the health check. Default: 300s." />
                  </Label>
                  <Input inputMode="numeric" value={interval} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setInterval(v ? Number(v) : 0); }} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    Timeout (ms) <InfoIcon title="Max wait time for each health check request. Default: 5000ms." />
                  </Label>
                  <Input inputMode="numeric" value={timeout} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setTimeout(v ? Number(v) : 0); }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    Max failed times <InfoIcon title="Number of consecutive failures before a proxy is removed. Default: 5." />
                  </Label>
                  <Input inputMode="numeric" value={maxFailedTimes} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setMaxFailedTimes(v ? Number(v) : 0); }} />
                </div>
                {type === 'url-test' ? (
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5">
                      Tolerance (ms) <InfoIcon title="Only switch proxy when latency difference exceeds this value. Default: 150ms." />
                    </Label>
                    <Input inputMode="numeric" value={tolerance} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setTolerance(v ? Number(v) : 0); }} />
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <input id="lazy-check" type="checkbox" checked={lazy} onChange={(e) => setLazy(e.target.checked)} className="h-4 w-4" />
                <label htmlFor="lazy-check" className="flex items-center gap-1.5 text-sm">
                  Lazy <InfoIcon title="Only run health checks when a request is being made, not on a fixed interval." />
                </label>
              </div>
            </>
          ) : null}
          {type === 'load-balance' ? (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                Strategy <InfoIcon title="round-robin: rotate proxies in order. consistent-hashing: same host uses same proxy. sticky-sessions: same client IP uses same proxy." />
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {LOAD_BALANCE_STRATEGIES.map((s) => (
                  <button key={s} type="button" onClick={() => setStrategy(s)}
                    className={cn('rounded-md border px-3 py-1.5 text-xs font-medium transition-all',
                      strategy === s ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground')}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RuleSetDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: ClashRuleSet | null;
  groupNames: string[];
  upstreamGroupNames: string[];
  onSubmit: (rs: ClashRuleSet) => void;
}

function RuleSetDialog({ open, onOpenChange, initial, groupNames, upstreamGroupNames, onSubmit }: RuleSetDialogProps) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [rulesText, setRulesText] = useState('');
  const [showTypePicker, setShowTypePicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setGroup(initial?.group ?? (groupNames[0] ?? upstreamGroupNames[0] ?? ''));
      setRulesText((initial?.rules ?? []).join('\n'));
      setShowTypePicker(false);
    }
  }, [open, initial, groupNames, upstreamGroupNames]);

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
    if (e.key === 'Enter') {
      setShowTypePicker(true);
    } else {
      setShowTypePicker(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rules = rulesText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    onSubmit({ name, group, rules });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Rule Set' : 'New Rule Set'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="GFW" required />
            </div>
            <div className="space-y-1.5">
              <Label>Target Group</Label>
              <select
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                required
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {groupNames.length > 0 ? (
                  <optgroup label="自定义分组">
                    {groupNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </optgroup>
                ) : null}
                {upstreamGroupNames.length > 0 ? (
                  <optgroup label="原分组">
                    {upstreamGroupNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </optgroup>
                ) : null}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Rules (one per line, e.g. DOMAIN-SUFFIX,google.com)</Label>
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
                {(['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'IP-CIDR6', 'GEOIP', 'PROCESS-NAME'] as const).map((t) => (
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
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ClashTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: cfg } = useQuery<ClashConfig>({
    queryKey: ['clash', 'config'],
    queryFn: () => apiGet<ClashConfig>('/api/clash/config'),
  });

  const [subscribeUrl, setSubscribeUrl] = useState('');
  const [refreshInterval, setRefreshInterval] = useState(60);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ClashGroup | null>(null);
  const [ruleSetDialogOpen, setRuleSetDialogOpen] = useState(false);
  const [editingRuleSet, setEditingRuleSet] = useState<ClashRuleSet | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (cfg && !initRef.current) {
      initRef.current = true;
      setSubscribeUrl(cfg.subscribe_url ?? '');
      setRefreshInterval(cfg.refresh_interval_minutes ?? 60);
    }
  }, [cfg]);

  const upstreamQuery = useQuery<UpstreamInfo>({
    queryKey: ['clash', 'upstream'],
    queryFn: () => apiGet<UpstreamInfo>('/api/clash/upstream'),
    enabled: !!cfg?.subscribe_url,
    retry: false,
  });

  const save = useMutation({
    mutationFn: (body: Partial<ClashConfig>) =>
      apiPut('/api/clash/config/save', { ...cfg, ...body }),
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['clash', 'config'] });
      qc.invalidateQueries({ queryKey: ['clash', 'upstream'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleGroupSubmit = (g: ClashGroup) => {
    const groups = cfg?.groups ?? [];
    const updated = editingGroup
      ? groups.map((x) => (x.name === editingGroup.name ? g : x))
      : [...groups, g];
    save.mutate({ groups: updated });
    setGroupDialogOpen(false);
    setEditingGroup(null);
  };

  const handleDeleteGroup = (name: string) => {
    save.mutate({ groups: (cfg?.groups ?? []).filter((g) => g.name !== name) });
  };

  const handleRuleSetSubmit = (rs: ClashRuleSet) => {
    const rule_sets = cfg?.rule_sets ?? [];
    const updated = editingRuleSet
      ? rule_sets.map((x) => (x.name === editingRuleSet.name ? rs : x))
      : [...rule_sets, rs];
    save.mutate({ rule_sets: updated });
    setRuleSetDialogOpen(false);
    setEditingRuleSet(null);
  };

  const handleDeleteRuleSet = (name: string) => {
    save.mutate({ rule_sets: (cfg?.rule_sets ?? []).filter((rs) => rs.name !== name) });
  };

  const handleMoveRuleSet = (index: number, dir: -1 | 1) => {
    const list = [...(cfg?.rule_sets ?? [])];
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const tmp = list[index]!;
    list[index] = list[target]!;
    list[target] = tmp;
    save.mutate({ rule_sets: list });
  };

  const handleToggleRuleSet = (name: string) => {
    const list = (cfg?.rule_sets ?? []).map((rs) =>
      rs.name === name ? { ...rs, enabled: rs.enabled === false } : rs,
    );
    save.mutate({ rule_sets: list });
  };

  const subscribeUrlWithKey = useMemo(
    () => cfg?.api_key ? `${window.location.origin}/api/clash/subscribe?api-key=${cfg.api_key}` : null,
    [cfg?.api_key],
  );

  const rotateKey = useMutation({
    mutationFn: () => api('/api/clash/subscribe/rotate-key', { method: 'POST' }),
    onSuccess: () => {
      toast.success('订阅密钥已更新');
      qc.invalidateQueries({ queryKey: ['clash', 'config'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const upstreamProxies = upstreamQuery.data?.proxies ?? [];
  const groupNames = (cfg?.groups ?? []).map((g) => g.name);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Clash Subscription &amp; Upstream</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Upstream Subscription URL</Label>
            <Input
              value={subscribeUrl}
              onChange={(e) => setSubscribeUrl(e.target.value)}
              onBlur={() => save.mutate({ subscribe_url: subscribeUrl })}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Auto-refresh interval (minutes)</Label>
            <Input
              type="number" min={1} className="w-40"
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              onBlur={() => save.mutate({ refresh_interval_minutes: refreshInterval })}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Subscribe URL with API Key</Label>
              <Button size="sm" variant="outline" onClick={() => rotateKey.mutate()} disabled={rotateKey.isPending}>
                {rotateKey.isPending ? 'Generating...' : cfg?.api_key ? 'Rotate Key' : 'Generate Key'}
              </Button>
            </div>
            {subscribeUrlWithKey ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{subscribeUrlWithKey}</code>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(subscribeUrlWithKey); toast.success('已复制'); }}>
                  Copy
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">点击「Generate Key」生成带鉴权的订阅地址，之前的 key 将失效。</p>
            )}
          </div>
          {upstreamQuery.data ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>Upstream nodes: <span className="text-foreground">{upstreamQuery.data.proxies?.length ?? 0}</span></div>
              <div>Upstream groups: <span className="text-foreground">{upstreamQuery.data.groups?.length ?? 0}</span></div>
              {upstreamQuery.data.fetchedAt ? (
                <div>Last refreshed: <span className="text-foreground">{new Date(upstreamQuery.data.fetchedAt).toLocaleString()}</span></div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Groups</span>
            <Button size="sm" onClick={() => { setEditingGroup(null); setGroupDialogOpen(true); }}>
              + New Group
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(cfg?.groups ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">No groups. Click "+ New Group" to add one.</div>
          ) : (cfg?.groups ?? []).map((g) => {
            const nodes = matchedProxies(g, upstreamProxies);
            const isExpanded = expandedGroup === g.name;
            return (
              <div key={g.name} className="rounded-md border border-border">
                <div className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-3"
                  onClick={() => setExpandedGroup(isExpanded ? null : g.name)}>
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{g.name}</span>
                      <Badge variant="secondary" className="text-xs">{g.type}</Badge>
                      {(g.keywords ?? []).map((kw) => (
                        <Badge key={kw} variant="outline" className="text-xs">{kw}</Badge>
                      ))}
                      {g.strategy ? <Badge variant="outline" className="text-xs text-muted-foreground">{g.strategy}</Badge> : null}
                      <span className="text-xs text-muted-foreground">{nodes.length} nodes</span>
                    </div>
                    {(g.inject_into && g.inject_into.length > 0) ? (
                      <div className="text-xs text-muted-foreground">
                        inject → <span className="text-foreground/70">{g.inject_into.join(', ')}</span>
                      </div>
                    ) : null}
                    {(g.interval !== undefined || g.timeout !== undefined || g.tolerance !== undefined || g.lazy !== undefined || g.max_failed_times !== undefined) ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {g.interval !== undefined ? <span>interval: <code className="text-foreground/70">{g.interval}s</code></span> : null}
                        {g.timeout !== undefined ? <span>timeout: <code className="text-foreground/70">{g.timeout}ms</code></span> : null}
                        {g.tolerance !== undefined ? <span>tolerance: <code className="text-foreground/70">{g.tolerance}ms</code></span> : null}
                        {g.lazy !== undefined ? <span>lazy: <code className="text-foreground/70">{String(g.lazy)}</code></span> : null}
                        {g.max_failed_times !== undefined ? <span>max-failed-times: <code className="text-foreground/70">{g.max_failed_times}</code></span> : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline" onClick={() => { setEditingGroup(g); setGroupDialogOpen(true); }}>Edit</Button>
                    <Button size="sm" variant="destructive" onClick={() => { if (window.confirm(`Delete group "${g.name}"?`)) handleDeleteGroup(g.name); }}>Delete</Button>
                  </div>
                </div>
                {isExpanded ? (
                  <div className="border-t border-border px-3 py-2">
                    {nodes.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {nodes.map((n) => <span key={n} className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{n}</span>)}
                      </div>
                    ) : <span className="text-xs text-muted-foreground">No matching nodes</span>}
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Rule Sets</span>
            <Button size="sm" onClick={() => { setEditingRuleSet(null); setRuleSetDialogOpen(true); }}>
              + New Rule Set
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(cfg?.rule_sets ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">No rule sets. Click "+ New Rule Set" to add one.</div>
          ) : (cfg?.rule_sets ?? []).map((rs, idx, arr) => {
            const isEnabled = rs.enabled !== false;
            return (
              <div key={rs.name} className={cn('flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-md border p-3 transition-colors',
                isEnabled ? 'border-border' : 'border-border/50 bg-muted/20 opacity-60')}
                onClick={() => { setEditingRuleSet(rs); setRuleSetDialogOpen(true); }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('font-medium', !isEnabled && 'line-through text-muted-foreground')}>{rs.name}</span>
                  <Badge variant="secondary" className="text-xs">→ {rs.group}</Badge>
                  <span className="text-xs text-muted-foreground">{rs.rules.length} rules</span>
                  {!isEnabled ? <Badge variant="outline" className="text-xs text-muted-foreground">disabled</Badge> : null}
                </div>
                <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="outline" disabled={idx === 0} onClick={() => handleMoveRuleSet(idx, -1)}>↑</Button>
                  <Button size="sm" variant="outline" disabled={idx === arr.length - 1} onClick={() => handleMoveRuleSet(idx, 1)}>↓</Button>
                  <Button size="sm" variant={isEnabled ? 'outline' : 'secondary'} onClick={() => handleToggleRuleSet(rs.name)}>
                    {isEnabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setEditingRuleSet(rs); setRuleSetDialogOpen(true); }}>Edit</Button>
                  <Button size="sm" variant="destructive" onClick={() => { if (window.confirm(`Delete rule set "${rs.name}"?`)) handleDeleteRuleSet(rs.name); }}>Delete</Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <GroupDialog
        open={groupDialogOpen}
        onOpenChange={(o) => { setGroupDialogOpen(o); if (!o) setEditingGroup(null); }}
        initial={editingGroup}
        upstreamGroupNames={upstreamQuery.data?.groups ?? []}
        onSubmit={handleGroupSubmit}
      />
      <RuleSetDialog
        open={ruleSetDialogOpen}
        onOpenChange={(o) => { setRuleSetDialogOpen(o); if (!o) setEditingRuleSet(null); }}
        initial={editingRuleSet}
        groupNames={groupNames}
        upstreamGroupNames={upstreamQuery.data?.groups ?? []}
        onSubmit={handleRuleSetSubmit}
      />
    </div>
  );
}
