import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface SettingsPayload {
  baseUrl: string;
  authToken: string;
  model: string;
  haikuModel: string;
  autoCompactEnabled: boolean;
  renderModelEnvEnabled: boolean;
  path: string;
}

interface TemplatePayload {
  content: string;
  path?: string;
  exists: boolean;
}

interface PowerlinePayload {
  content: string;
  exists: boolean;
}

interface OnboardingPayload {
  skipped: boolean;
}

export function ClaudeSettings() {
  const qc = useQueryClient();
  const { data: settings } = useQuery<SettingsPayload>({
    queryKey: ['claude', 'settings'],
    queryFn: () => apiGet<SettingsPayload>('/api/claude/settings'),
  });
  const { data: template } = useQuery<TemplatePayload>({
    queryKey: ['claude', 'settings', 'template'],
    queryFn: () => apiGet<TemplatePayload>('/api/claude/settings/template'),
  });
  const { data: powerline } = useQuery<PowerlinePayload>({
    queryKey: ['claude', 'powerline'],
    queryFn: () => apiGet<PowerlinePayload>('/api/claude/powerline'),
  });
  const { data: onboarding } = useQuery<OnboardingPayload>({
    queryKey: ['claude', 'onboarding'],
    queryFn: () => apiGet<OnboardingPayload>('/api/claude/onboarding'),
  });

  const [baseUrl, setBaseUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [model, setModel] = useState('');
  const [haikuModel, setHaikuModel] = useState('');
  const [tplContent, setTplContent] = useState('');
  const [plContent, setPlContent] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (settings) {
      setBaseUrl(settings.baseUrl ?? '');
      setAuthToken(settings.authToken ?? '');
      setModel(settings.model ?? '');
      setHaikuModel(settings.haikuModel ?? '');
    }
  }, [settings]);
  useEffect(() => {
    if (template) setTplContent(template.content ?? '');
  }, [template]);
  useEffect(() => {
    if (powerline) setPlContent(powerline.content ?? '');
  }, [powerline]);

  const saveSettings = useMutation({
    mutationFn: () =>
      apiPost('/api/claude/settings/save', { baseUrl, authToken, model, haikuModel }),
    onSuccess: () => {
      setNotice('设置已保存');
      setError('');
      qc.invalidateQueries({ queryKey: ['claude', 'settings'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const setAutoCompact = useMutation({
    mutationFn: (enabled: boolean) =>
      apiPost('/api/claude/settings/auto-compact/set', { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claude', 'settings'] }),
  });
  const setRenderModelEnv = useMutation({
    mutationFn: (enabled: boolean) =>
      apiPost('/api/claude/settings/render-model-env/set', { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claude', 'settings'] }),
  });
  const skipOnboarding = useMutation({
    mutationFn: () => apiPost('/api/claude/onboarding/skip'),
    onSuccess: () => {
      setNotice('已跳过 onboarding');
      qc.invalidateQueries({ queryKey: ['claude', 'onboarding'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const saveTemplate = useMutation({
    mutationFn: (content: string) => apiPost('/api/claude/settings/template/save', { content }),
    onSuccess: () => {
      setNotice('模版已保存');
      setError('');
      qc.invalidateQueries({ queryKey: ['claude', 'settings', 'template'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const savePowerline = useMutation({
    mutationFn: (content: string) => apiPost('/api/claude/powerline/save', { content }),
    onSuccess: () => {
      setNotice('powerline 已保存');
      setError('');
      qc.invalidateQueries({ queryKey: ['claude', 'powerline'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const handleSaveTemplate = () => {
    setNotice('');
    setError('');
    try {
      JSON.parse(tplContent);
    } catch {
      setError('模版 JSON 格式错误');
      return;
    }
    saveTemplate.mutate(tplContent);
  };
  const handleSavePowerline = () => {
    setNotice('');
    setError('');
    try {
      JSON.parse(plContent);
    } catch {
      setError('powerline JSON 格式错误');
      return;
    }
    savePowerline.mutate(plContent);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Claude 设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            settings.json: <code>{settings?.path || '~/.claude/settings.json'}</code>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>ANTHROPIC_BASE_URL</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>ANTHROPIC_AUTH_TOKEN</Label>
              <Input value={authToken} onChange={(e) => setAuthToken(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>ANTHROPIC_MODEL</Label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>ANTHROPIC_DEFAULT_HAIKU_MODEL</Label>
              <Input value={haikuModel} onChange={(e) => setHaikuModel(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div>
              <Label>自动压缩 (autoCompactEnabled)</Label>
              <p className="text-xs text-muted-foreground">控制 Claude 的对话自动压缩</p>
            </div>
            <Switch
              checked={!!settings?.autoCompactEnabled}
              onCheckedChange={(v) => setAutoCompact.mutate(v)}
              disabled={setAutoCompact.isPending}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div>
              <Label>渲染模型环境变量 (renderModelEnv)</Label>
              <p className="text-xs text-muted-foreground">关闭后将不写入 ANTHROPIC_MODEL 等环境变量</p>
            </div>
            <Switch
              checked={!!settings?.renderModelEnvEnabled}
              onCheckedChange={(v) => setRenderModelEnv.mutate(v)}
              disabled={setRenderModelEnv.isPending}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div>
              <Label>跳过 Onboarding</Label>
              <p className="text-xs text-muted-foreground">
                状态: {onboarding?.skipped ? '已跳过' : '未跳过'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => skipOnboarding.mutate()}
              disabled={skipOnboarding.isPending || !!onboarding?.skipped}
            >
              {onboarding?.skipped ? '已跳过' : '跳过'}
            </Button>
          </div>
          {notice ? <div className="text-xs text-green-500">{notice}</div> : null}
          {error ? <div className="text-xs text-destructive">{error}</div> : null}
          <div className="flex gap-2">
            <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
              {saveSettings.isPending ? '保存中...' : '保存设置'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>settings.json 模版</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            模版路径: <code>{template?.path || 'conf/claude/settings.json'}</code>
          </div>
          <textarea
            value={tplContent}
            onChange={(e) => setTplContent(e.target.value)}
            spellCheck={false}
            className="h-72 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
          />
          <Button onClick={handleSaveTemplate} disabled={saveTemplate.isPending}>
            {saveTemplate.isPending ? '保存中...' : '保存模版'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Powerline 配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            <code>conf/claude/claude-powerline.json</code>
          </div>
          <textarea
            value={plContent}
            onChange={(e) => setPlContent(e.target.value)}
            spellCheck={false}
            className="h-60 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
          />
          <Button onClick={handleSavePowerline} disabled={savePowerline.isPending}>
            {savePowerline.isPending ? '保存中...' : '保存 Powerline'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
