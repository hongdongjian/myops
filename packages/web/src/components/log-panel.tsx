import { useEffect, useRef } from 'react';
import { useStatusPolling } from '@/lib/use-status-polling';
import { apiPost } from '@/lib/api';
import { Button } from './ui/button';

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

export function LogPanel({ path, intervalMs = 3000, height = '420px', clearPath }: LogPanelProps) {
  const { data, refetch, isLoading, error } = useStatusPolling<unknown>(['log', path], path, intervalMs);
  const text = extractText(data);
  const lineCount = text ? text.split('\n').length : 0;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

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
    <div className="overflow-hidden rounded-md border border-border bg-card shadow-sm">
      {/* Terminal chrome */}
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="flex gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
          </span>
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            stdout · {lineCount} line{lineCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => refetch()}>
            Refresh
          </Button>
          {clearPath ? (
            <Button size="sm" variant="ghost" onClick={handleClear}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <div ref={scrollRef} className="scanlines bg-muted/20 overflow-y-auto" style={{ height }}>
        <pre className="px-4 py-3 font-mono text-[12px] leading-[1.55] text-foreground whitespace-pre-wrap break-words">
          {error ? (
            <span className="text-destructive">Load failed: {(error as Error).message}</span>
          ) : isLoading && !text ? (
            <span className="text-muted-foreground">Loading<span className="caret" /></span>
          ) : text ? (
            text
          ) : (
            <span className="text-muted-foreground">(empty)<span className="caret" /></span>
          )}
        </pre>
      </div>
    </div>
  );
}
