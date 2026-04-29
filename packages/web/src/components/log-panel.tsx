import { useStatusPolling } from '@/lib/use-status-polling';
import { apiPost } from '@/lib/api';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';

export interface LogPanelProps {
  path: string;
  intervalMs?: number;
  height?: string;
  clearPath?: string;
}

interface LogResponse {
  content?: string;
  log?: string;
  lines?: string[];
}

function extractText(data: unknown): string {
  if (!data) return '';
  if (typeof data === 'string') return data;
  const d = data as LogResponse;
  if (typeof d.content === 'string') return d.content;
  if (typeof d.log === 'string') return d.log;
  if (Array.isArray(d.lines)) return d.lines.join('\n');
  return '';
}

export function LogPanel({ path, intervalMs = 3000, height = '400px', clearPath }: LogPanelProps) {
  const { data, refetch, isLoading, error } = useStatusPolling<unknown>(['log', path], path, intervalMs);
  const text = extractText(data);

  const handleClear = async () => {
    if (!clearPath) return;
    try {
      await apiPost(clearPath);
      await refetch();
    } catch (e) {
      console.error('clear log failed', e);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => refetch()}>刷新</Button>
        {clearPath ? (
          <Button size="sm" variant="outline" onClick={handleClear}>清空</Button>
        ) : null}
      </div>
      <ScrollArea className="rounded-md border border-border bg-muted/30" style={{ height }}>
        <pre className="p-3 font-mono text-xs whitespace-pre-wrap break-words">
          {error ? `加载失败: ${(error as Error).message}` : isLoading && !text ? '加载中...' : text || '(空)'}
        </pre>
      </ScrollArea>
    </div>
  );
}
