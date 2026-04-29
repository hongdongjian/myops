import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ClashGroup {
  name: string;
  type: string;
  proxies: string[];
}

interface ClashRuleSet {
  name: string;
  group: string;
  rules: string[];
}

interface ClashConfig {
  subscribe_url: string;
  groups: ClashGroup[];
  rule_sets: ClashRuleSet[];
}

interface UpstreamInfo {
  proxies: string[];
  groups: string[];
}

const apiPut = (path: string, body: unknown) =>
  api(path, { method: 'PUT', body: JSON.stringify(body) });

const apiPost = (path: string, body?: unknown) =>
  api(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });

export function ClashTab() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery<ClashConfig>({
    queryKey: ['clash', 'config'],
    queryFn: () => apiGet<ClashConfig>('/api/clash/config'),
  });

  const [subscribeUrl, setSubscribeUrl] = useState('');
  const [groupsText, setGroupsText] = useState('');
  const [rulesText, setRulesText] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (cfg) {
      setSubscribeUrl(cfg.subscribe_url ?? '');
      setGroupsText(JSON.stringify(cfg.groups ?? [], null, 2));
      setRulesText(JSON.stringify(cfg.rule_sets ?? [], null, 2));
    }
  }, [cfg]);

  const upstreamQuery = useQuery<UpstreamInfo>({
    queryKey: ['clash', 'upstream'],
    queryFn: () => apiGet<UpstreamInfo>('/api/clash/upstream'),
    enabled: !!cfg?.subscribe_url,
    retry: false,
  });

  const save = useMutation({
    mutationFn: (body: ClashConfig) => apiPut('/api/clash/config/save', body),
    onSuccess: () => {
      setNotice('已保存');
      setError('');
      qc.invalidateQueries({ queryKey: ['clash', 'config'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const refreshUpstream = useMutation({
    mutationFn: () => apiPost('/api/clash/upstream/refresh'),
    onSuccess: () => {
      setNotice('上游已刷新');
      setError('');
      qc.invalidateQueries({ queryKey: ['clash', 'upstream'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const handleSave = () => {
    setNotice('');
    setError('');
    let groups: ClashGroup[];
    let rule_sets: ClashRuleSet[];
    try {
      groups = JSON.parse(groupsText);
      rule_sets = JSON.parse(rulesText);
    } catch (e) {
      setError(`JSON 解析失败: ${(e as Error).message}`);
      return;
    }
    save.mutate({ subscribe_url: subscribeUrl, groups, rule_sets });
  };

  const subscribeUrlValue = useMemo(() => `${window.location.origin}/api/clash/subscribe`, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Clash 订阅与上游</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>上游订阅 URL</Label>
            <Input value={subscribeUrl} onChange={(e) => setSubscribeUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="text-xs text-muted-foreground">
            订阅本地配置: <code>{subscribeUrlValue}</code>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={save.isPending}>{save.isPending ? '保存中...' : '保存配置'}</Button>
            <Button variant="outline" onClick={() => refreshUpstream.mutate()} disabled={refreshUpstream.isPending || !cfg?.subscribe_url}>
              {refreshUpstream.isPending ? '刷新中...' : '刷新上游'}
            </Button>
          </div>
          {notice ? <div className="text-xs text-green-500">{notice}</div> : null}
          {error ? <div className="text-xs text-destructive">{error}</div> : null}
          {upstreamQuery.data ? (
            <div className="space-y-2 text-xs">
              <div>
                <span className="text-muted-foreground">上游节点: </span>
                <span>{upstreamQuery.data.proxies?.length ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">上游分组: </span>
                <span>{upstreamQuery.data.groups?.length ?? 0}</span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>分组 (JSON)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <textarea
            value={groupsText}
            onChange={(e) => setGroupsText(e.target.value)}
            spellCheck={false}
            className="h-72 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
            placeholder='[{"name":"PROXY","type":"select","proxies":["DIRECT"]}]'
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>规则集 (JSON)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <textarea
            value={rulesText}
            onChange={(e) => setRulesText(e.target.value)}
            spellCheck={false}
            className="h-72 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
            placeholder='[{"name":"GFW","group":"PROXY","rules":["DOMAIN-SUFFIX,google.com"]}]'
          />
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={save.isPending}>{save.isPending ? '保存中...' : '保存配置'}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
