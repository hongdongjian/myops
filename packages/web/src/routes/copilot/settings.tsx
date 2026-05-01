import { useEffect, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { useStatusPolling } from '@/lib/use-status-polling';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/toast';
import type { AutostartState, ConfigPayload, ConfigSyncStatus, CopilotStatus, PortState, ProxyState } from './types';

export function CopilotSettings() {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: status } = useStatusPolling<CopilotStatus>(
    ['copilot', 'status'],
    '/api/copilot/status',
    2000,
  );
  const { data: autostart } = useQuery<AutostartState>({
    queryKey: ['copilot', 'autostart'],
    queryFn: () => apiGet<AutostartState>('/api/copilot/autostart'),
  });
  const { data: proxy } = useQuery<ProxyState>({
    queryKey: ['copilot', 'proxy'],
    queryFn: () => apiGet<ProxyState>('/api/copilot/proxy'),
  });
  const { data: portData } = useQuery<PortState>({
    queryKey: ['copilot', 'port'],
    queryFn: () => apiGet<PortState>('/api/copilot/port'),
  });
  const { data: config, isLoading: configLoading } = useQuery<ConfigPayload>({
    queryKey: ['copilot', 'config'],
    queryFn: () => apiGet<ConfigPayload>('/api/copilot/config'),
  });
  const { data: syncStatus } = useQuery<ConfigSyncStatus>({
    queryKey: ['copilot', 'config', 'sync-status'],
    queryFn: () => apiGet<ConfigSyncStatus>('/api/copilot/config/sync-status'),
    refetchInterval: 5000,
  });

  const running = !!status?.process?.running;

  const [portInput, setPortInput] = useState('4141');
  useEffect(() => {
    if (portData?.port !== undefined) setPortInput(String(portData.port));
  }, [portData?.port]);

  const [configContent, setConfigContent] = useState('');
  useEffect(() => {
    if (config) setConfigContent(config.content ?? '');
  }, [config]);

  const start = useMutation({
    mutationFn: () => apiPost('/api/copilot/start'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const stop = useMutation({
    mutationFn: () => apiPost('/api/copilot/stop'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const restart = useMutation({
    mutationFn: () => apiPost('/api/copilot/restart'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const setAutostart = useMutation({
    mutationFn: (enabled: boolean) => apiPost<AutostartState>('/api/copilot/autostart/set', { enabled }),
    onSuccess: (data) => qc.setQueryData(['copilot', 'autostart'], data),
  });
  const setProxy = useMutation({
    mutationFn: (enabled: boolean) => apiPost<ProxyState>('/api/copilot/proxy/set', { enabled }),
    onSuccess: (data) => {
      qc.setQueryData(['copilot', 'proxy'], data);
      qc.invalidateQueries({ queryKey: ['copilot', 'status'] });
    },
  });
  const setPort = useMutation({
    mutationFn: (port: number) => apiPost<PortState>('/api/copilot/port/set', { port }),
    onSuccess: (data) => {
      qc.setQueryData(['copilot', 'port'], data);
      qc.invalidateQueries({ queryKey: ['copilot', 'status'] });
      toast.success('Port saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveConfig = useMutation({
    mutationFn: (text: string) => apiPost('/api/copilot/config/save', { content: text }),
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['copilot', 'config'] });
      qc.invalidateQueries({ queryKey: ['copilot', 'config', 'sync-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const syncConfig = useMutation({
    mutationFn: () => apiPost('/api/copilot/config/sync'),
    onSuccess: () => {
      toast.success('Synced');
      qc.invalidateQueries({ queryKey: ['copilot', 'config', 'sync-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSaveConfig = () => {
    if (configContent.trim() === '') { toast.error('Content cannot be empty'); return; }
    try { JSON.parse(configContent); } catch { toast.error('JSON parse failed, check format'); return; }
    saveConfig.mutate(configContent, {
      onSuccess: () => syncConfig.mutate(),
    });
  };

  const handleJsonKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, setter: (v: string) => void) => {
    const ta = e.currentTarget;
    if (e.key === 'Enter') {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const value = ta.value;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const currentLine = value.slice(lineStart, start);
      const indentMatch = currentLine.match(/^[ \t]*/);
      let indent = indentMatch ? indentMatch[0] : '';
      const prevChar = value.slice(0, start).trimEnd().slice(-1);
      const nextChar = value.slice(end).trimStart().charAt(0);
      const opensBlock = prevChar === '{' || prevChar === '[';
      const closesBlock = nextChar === '}' || nextChar === ']';
      let insert = '\n' + indent;
      if (opensBlock) {
        insert = '\n' + indent + '  ';
        if (closesBlock) insert += '\n' + indent;
      }
      const next = value.slice(0, start) + insert + value.slice(end);
      setter(next);
      const caret = start + (opensBlock ? 1 + indent.length + 2 : insert.length);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = caret; });
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const value = ta.value;
      const next = value.slice(0, start) + '  ' + value.slice(end);
      setter(next);
      const caret = start + 2;
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = caret; });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span>copilot-api</span>
            <StatusBadge running={running} />
            {status?.sourceUrl ? (
              <a href={status.sourceUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs text-muted-foreground hover:underline">
                Source
              </a>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={running ? 'outline' : 'default'}
                onClick={() => running ? stop.mutate() : start.mutate()}
                disabled={start.isPending || stop.isPending}
              >
                {start.isPending || stop.isPending ? 'Working...' : running ? 'Stop' : 'Start'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => restart.mutate()}
                disabled={!running || restart.isPending}
              >
                {restart.isPending ? 'Restarting...' : 'Restart'}
              </Button>
            </div>

            <div className="flex items-center gap-2 border-l border-border pl-6">
              <Label className="text-sm">Auto-start</Label>
              <Switch
                checked={!!autostart?.enabled}
                onCheckedChange={(v) => setAutostart.mutate(v)}
                disabled={setAutostart.isPending}
              />
            </div>

            <div className="flex items-center gap-2 border-l border-border pl-6">
              <Label className="text-sm">Proxy</Label>
              <Switch
                checked={!!proxy?.enabled}
                onCheckedChange={(v) => setProxy.mutate(v)}
                disabled={setProxy.isPending}
              />
            </div>

            <div className="flex items-center gap-2 border-l border-border pl-6">
              <Label className="text-sm whitespace-nowrap">Port</Label>
              <Input
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                onBlur={() => {
                  const n = parseInt(portInput, 10);
                  if (!Number.isInteger(n) || n <= 0) { toast.error('Invalid port'); return; }
                  if (n === portData?.port) return;
                  setPort.mutate(n);
                }}
                placeholder="4141"
                className="w-24 text-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>config.json</span>
            {syncStatus ? (
              syncStatus.synced ? (
                <Badge className="bg-green-600 text-white">Applied</Badge>
              ) : (
                <Badge variant="secondary">Out of sync</Badge>
              )
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Template: <code>{config?.path || 'conf/copilot-api/config.json'}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            Target: <code>~/.local/share/copilot-api/config.json</code>
          </div>
          <div className="text-xs text-muted-foreground">
            Apply strategy: overwrite <code>~/.local/share/copilot-api/config.json</code> entirely with the template content.
          </div>
          <textarea
            value={configContent}
            onChange={(e) => setConfigContent(e.target.value)}
            onKeyDown={(e) => handleJsonKeyDown(e, setConfigContent)}
            spellCheck={false}
            className="h-96 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
            placeholder={configLoading ? 'Loading...' : 'Config JSON'}
          />
          <Button onClick={handleSaveConfig} disabled={saveConfig.isPending || syncConfig.isPending}>
            {saveConfig.isPending || syncConfig.isPending ? 'Applying...' : 'Apply'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
