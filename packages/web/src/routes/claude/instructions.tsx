import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/toast';

interface InstructionsPayload {
  path: string;
  syncedPath: string;
  content: string;
  exists: boolean;
}

interface SyncStatusPayload {
  synced: boolean;
  localExists: boolean;
}

export function ClaudeInstructions() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery<InstructionsPayload>({
    queryKey: ['claude', 'instructions'],
    queryFn: () => apiGet<InstructionsPayload>('/api/claude/instructions'),
  });
  const { data: syncStatus } = useQuery<SyncStatusPayload>({
    queryKey: ['claude', 'instructions', 'sync-status'],
    queryFn: () => apiGet<SyncStatusPayload>('/api/claude/instructions/sync-status'),
    refetchInterval: 5000,
  });

  const [content, setContent] = useState('');

  useEffect(() => {
    if (data) setContent(data.content ?? '');
  }, [data]);

  const apply = useMutation({
    mutationFn: async (text: string) => {
      await apiPost('/api/claude/instructions/save', { content: text });
      await apiPost('/api/claude/instructions/sync');
    },
    onSuccess: () => {
      toast.success('CLAUDE.md applied');
      qc.invalidateQueries({ queryKey: ['claude', 'instructions'] });
      qc.invalidateQueries({ queryKey: ['claude', 'instructions', 'sync-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleApply = () => {
    apply.mutate(content);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>CLAUDE.md</span>
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
          Template: <code>{data?.path || 'conf/claude/CLAUDE.md'}</code>
        </div>
        <div className="text-xs text-muted-foreground">
          Target: <code>{data?.syncedPath || '~/.claude/CLAUDE.md'}</code>
        </div>
        <div className="text-xs text-muted-foreground">
          Apply strategy: overwrite <code>~/.claude/CLAUDE.md</code> entirely with the template content.
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="h-72 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
        />
        <Button onClick={handleApply} disabled={apply.isPending}>
          {apply.isPending ? 'Applying...' : 'Apply'}
        </Button>
      </CardContent>
    </Card>
  );
}
