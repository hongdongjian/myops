import { useEffect, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/toast';
import { ClaudeInstructions } from './instructions';

interface SettingsPathPayload {
  path: string;
}

interface TemplatePayload {
  content: string;
  path?: string;
  exists: boolean;
}

interface GlobalConfigPayload {
  content: string;
  path?: string;
  templatePath?: string;
  exists: boolean;
}

interface SyncStatusPayload {
  synced: boolean;
  templateExists: boolean;
  targetExists: boolean;
}

function SyncBadge({ status }: { status?: SyncStatusPayload }) {
  if (!status) return null;
  if (status.synced) return <Badge className="bg-green-600 text-white">Applied</Badge>;
  return <Badge variant="secondary">Out of sync</Badge>;
}

export function ClaudeSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery<SettingsPathPayload>({
    queryKey: ['claude', 'settings'],
    queryFn: () => apiGet<SettingsPathPayload>('/api/claude/settings'),
  });
  const { data: template } = useQuery<TemplatePayload>({
    queryKey: ['claude', 'settings', 'template'],
    queryFn: () => apiGet<TemplatePayload>('/api/claude/settings/template'),
  });
  const { data: globalConfig } = useQuery<GlobalConfigPayload>({
    queryKey: ['claude', 'global-config'],
    queryFn: () => apiGet<GlobalConfigPayload>('/api/claude/global-config'),
  });
  const { data: tplSync } = useQuery<SyncStatusPayload>({
    queryKey: ['claude', 'settings', 'template', 'sync-status'],
    queryFn: () => apiGet<SyncStatusPayload>('/api/claude/settings/template/sync-status'),
    refetchInterval: 5000,
  });
  const { data: gcSync } = useQuery<SyncStatusPayload>({
    queryKey: ['claude', 'global-config', 'sync-status'],
    queryFn: () => apiGet<SyncStatusPayload>('/api/claude/global-config/sync-status'),
    refetchInterval: 5000,
  });

  const [tplContent, setTplContent] = useState('');
  const [gcContent, setGcContent] = useState('');

  useEffect(() => {
    if (template) setTplContent(template.content ?? '');
  }, [template]);
  useEffect(() => {
    if (globalConfig) setGcContent(globalConfig.content ?? '');
  }, [globalConfig]);

  const saveTemplate = useMutation({
    mutationFn: (content: string) => apiPost('/api/claude/settings/template/save', { content }),
    onSuccess: () => {
      toast.success('settings.json applied');
      qc.invalidateQueries({ queryKey: ['claude', 'settings', 'template'] });
      qc.invalidateQueries({ queryKey: ['claude', 'settings'] });
      qc.invalidateQueries({ queryKey: ['claude', 'settings', 'template', 'sync-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveGlobalConfig = useMutation({
    mutationFn: (content: string) => apiPost('/api/claude/global-config/save', { content }),
    onSuccess: () => {
      toast.success('claude.json applied');
      qc.invalidateQueries({ queryKey: ['claude', 'global-config'] });
      qc.invalidateQueries({ queryKey: ['claude', 'global-config', 'sync-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSaveTemplate = () => {
    try {
      JSON.parse(tplContent);
    } catch {
      toast.error('settings.json is not valid JSON');
      return;
    }
    saveTemplate.mutate(tplContent);
  };
  const handleSaveGlobalConfig = () => {
    try {
      JSON.parse(gcContent);
    } catch {
      toast.error('~/.claude.json is not valid JSON');
      return;
    }
    saveGlobalConfig.mutate(gcContent);
  };

  const handleJsonKeyDown = (
    e: KeyboardEvent<HTMLTextAreaElement>,
    setter: (v: string) => void,
  ) => {
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
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = caret;
      });
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
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = caret;
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>settings.json</span>
            <SyncBadge status={tplSync} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Template: <code>{template?.path || 'conf/claude/settings.json'}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            Target: <code>{settings?.path || '~/.claude/settings.json'}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            Apply strategy: overwrite <code>~/.claude/settings.json</code> entirely with the template content.
          </div>
          <textarea
            value={tplContent}
            onChange={(e) => setTplContent(e.target.value)}
            onKeyDown={(e) => handleJsonKeyDown(e, setTplContent)}
            spellCheck={false}
            className="h-72 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
          />
          <Button onClick={handleSaveTemplate} disabled={saveTemplate.isPending}>
            {saveTemplate.isPending ? 'Applying...' : 'Apply'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>claude.json</span>
            <SyncBadge status={gcSync} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Template: <code>{globalConfig?.templatePath || 'conf/claude/claude.json'}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            Target: <code>{globalConfig?.path || '~/.claude.json'}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            Apply strategy: merge top-level keys into <code>~/.claude.json</code>; fields not present here are kept untouched.
          </div>
          <textarea
            value={gcContent}
            onChange={(e) => setGcContent(e.target.value)}
            onKeyDown={(e) => handleJsonKeyDown(e, setGcContent)}
            spellCheck={false}
            className="h-72 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
          />
          <Button onClick={handleSaveGlobalConfig} disabled={saveGlobalConfig.isPending}>
            {saveGlobalConfig.isPending ? 'Applying...' : 'Apply'}
          </Button>
        </CardContent>
      </Card>

      <ClaudeInstructions />
    </div>
  );
}
