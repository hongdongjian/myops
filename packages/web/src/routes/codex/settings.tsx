import { useEffect, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/toast';

interface CodexTemplatePayload {
  content: string;
  path: string;
  exists: boolean;
}

interface AgentsPayload {
  path: string;
  syncedPath: string;
  content: string;
  exists: boolean;
}

interface TemplateSyncStatusPayload {
  synced: boolean;
  templateExists: boolean;
  targetExists: boolean;
}

interface AgentsSyncStatusPayload {
  synced: boolean;
  localExists: boolean;
}

function SyncBadge({ status }: { status?: { synced: boolean } }) {
  if (!status) return null;
  if (status.synced) return <Badge className="bg-green-600 text-white">Applied</Badge>;
  return <Badge variant="secondary">Out of sync</Badge>;
}

export function CodexSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: tpl } = useQuery<CodexTemplatePayload>({
    queryKey: ['codex', 'settings', 'template'],
    queryFn: () => apiGet<CodexTemplatePayload>('/api/codex/settings/template'),
  });
  const { data: tplSync } = useQuery<TemplateSyncStatusPayload>({
    queryKey: ['codex', 'settings', 'template', 'sync-status'],
    queryFn: () => apiGet<TemplateSyncStatusPayload>('/api/codex/settings/template/sync-status'),
    refetchInterval: 5000,
  });
  const { data: agents, isLoading: agentsLoading } = useQuery<AgentsPayload>({
    queryKey: ['codex', 'agents'],
    queryFn: () => apiGet<AgentsPayload>('/api/codex/agents'),
  });
  const { data: agentsSync } = useQuery<AgentsSyncStatusPayload>({
    queryKey: ['codex', 'agents', 'sync-status'],
    queryFn: () => apiGet<AgentsSyncStatusPayload>('/api/codex/agents/sync-status'),
    refetchInterval: 5000,
  });

  const [tplContent, setTplContent] = useState('');
  const [agentsContent, setAgentsContent] = useState('');

  useEffect(() => {
    if (tpl) setTplContent(tpl.content ?? '');
  }, [tpl]);
  useEffect(() => {
    if (agents) setAgentsContent(agents.content ?? '');
  }, [agents]);

  const saveTpl = useMutation({
    mutationFn: (content: string) => apiPost('/api/codex/settings/template/save', { content }),
    onSuccess: () => {
      toast.success('config.toml applied');
      qc.invalidateQueries({ queryKey: ['codex', 'settings', 'template'] });
      qc.invalidateQueries({ queryKey: ['codex', 'settings', 'template', 'sync-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const applyAgents = useMutation({
    mutationFn: (text: string) => apiPost('/api/codex/agents/apply', { content: text }),
    onSuccess: () => {
      toast.success('AGENTS.md applied');
      qc.invalidateQueries({ queryKey: ['codex', 'agents'] });
      qc.invalidateQueries({ queryKey: ['codex', 'agents', 'sync-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleKeyDown = (
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
      const indent = indentMatch ? indentMatch[0] : '';
      const insert = '\n' + indent;
      const next = value.slice(0, start) + insert + value.slice(end);
      setter(next);
      const caret = start + insert.length;
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
            <span>config.toml</span>
            <SyncBadge status={tplSync} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Template: <code>{tpl?.path || 'conf/codex/config.toml'}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            Target: <code>~/.codex/config.toml</code>
          </div>
          <div className="text-xs text-muted-foreground">
            Apply strategy: sync existing keys into <code>~/.codex/config.toml</code>; other keys are kept untouched.
          </div>
          <textarea
            value={tplContent}
            onChange={(e) => setTplContent(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, setTplContent)}
            spellCheck={false}
            className="h-72 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
          />
          <Button onClick={() => saveTpl.mutate(tplContent)} disabled={saveTpl.isPending}>
            {saveTpl.isPending ? 'Applying...' : 'Apply'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>AGENTS.md</span>
            <SyncBadge status={agentsSync} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Template: <code>{agents?.path || 'conf/codex/AGENTS.md'}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            Target: <code>{agents?.syncedPath || '~/.codex/AGENTS.md'}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            Apply strategy: overwrite <code>~/.codex/AGENTS.md</code> entirely with the template content.
          </div>
          <textarea
            value={agentsContent}
            onChange={(e) => setAgentsContent(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, setAgentsContent)}
            spellCheck={false}
            className="h-[480px] w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
            placeholder={agentsLoading ? 'Loading...' : 'Enter AGENTS.md content here'}
          />
          <Button onClick={() => applyAgents.mutate(agentsContent)} disabled={applyAgents.isPending}>
            {applyAgents.isPending ? 'Applying...' : 'Apply'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
