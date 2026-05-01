import { cn } from '@/lib/cn';

export function StatusBadge({ running }: { running: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide',
        running
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-border bg-muted text-muted-foreground',
      )}
    >
      <span className={cn('live-dot', !running && 'idle')} />
      {running ? 'Running' : 'Stopped'}
    </span>
  );
}
