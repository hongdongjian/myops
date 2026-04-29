import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ModelSelect } from '@/components/model-select';

interface CodexSettingsPayload {
  baseUrl: string;
  apiKey: string;
  model: string;
  authMode: boolean;
  path: string;
}

interface CodexTemplatePayload {
  content: string;
  path: string;
  exists: boolean;
}

export function CodexSettings() {
  const qc = useQueryClient();
  const { data } = useQuery<CodexSettingsPayload>({
    queryKey: ['codex', 'settings'],
    queryFn: () => apiGet<CodexSettingsPayload>('/api/codex/settings'),
  });
  const { data: tpl } = useQuery<CodexTemplatePayload>({
    queryKey: ['codex', 'settings', 'template'],
    queryFn: () => apiGet<CodexTemplatePayload>('/api/codex/settings/template'),
  });

  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [tplContent, setTplContent] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (data) {
      setBaseUrl(data.baseUrl ?? '');
      setApiKey(data.apiKey ?? '');
      setModel(data.model ?? '');
    }
  }, [data]);
  useEffect(() => {
    if (tpl) setTplContent(tpl.content ?? '');
  }, [tpl]);

  const save = useMutation({
    mutationFn: () => apiPost('/api/codex/settings/save', { baseUrl, apiKey, model }),
    onSuccess: () => {
      setNotice('已保存');
      setError('');
      qc.invalidateQueries({ queryKey: ['codex', 'settings'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const setAuthMode = useMutation({
    mutationFn: (enabled: boolean) =>
      apiPost('/api/codex/settings/auth-mode/set', { enabled, baseUrl, apiKey }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['codex', 'settings'] }),
    onError: (e: Error) => setError(e.message),
  });
  const saveTpl = useMutation({
    mutationFn: (content: string) => apiPost('/api/codex/settings/template/save', { content }),
    onSuccess: () => {
      setNotice('模版已保存');
      setError('');
      qc.invalidateQueries({ queryKey: ['codex', 'settings', 'template'] });
      qc.invalidateQueries({ queryKey: ['codex', 'settings'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Codex 设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            config.toml: <code>{data?.path || '~/.codex/config.toml'}</code>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <div>
              <Label>账号登录模式 (authMode)</Label>
              <p className="text-xs text-muted-foreground">开启后使用账号登录，关闭后使用自定义 base_url + apiKey</p>
            </div>
            <Switch
              checked={!!data?.authMode}
              onCheckedChange={(v) => setAuthMode.mutate(v)}
              disabled={setAuthMode.isPending}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>base_url</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:4141" disabled={!!data?.authMode} />
            </div>
            <div className="space-y-1">
              <Label>api_key</Label>
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="dummy" disabled={!!data?.authMode} />
            </div>
            <div className="space-y-1">
              <Label>model</Label>
              <ModelSelect value={model} onChange={setModel} />
            </div>
          </div>
          {notice ? <div className="text-xs text-green-500">{notice}</div> : null}
          {error ? <div className="text-xs text-destructive">{error}</div> : null}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? '保存中...' : '保存设置'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>config.toml 模版</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            模版路径: <code>{tpl?.path || 'conf/codex/config.toml'}</code>
          </div>
          <textarea
            value={tplContent}
            onChange={(e) => setTplContent(e.target.value)}
            spellCheck={false}
            className="h-72 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
          />
          <Button onClick={() => saveTpl.mutate(tplContent)} disabled={saveTpl.isPending}>
            {saveTpl.isPending ? '保存中...' : '保存模版'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
