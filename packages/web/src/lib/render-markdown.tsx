import type { ReactNode } from 'react';

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

export function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

export function renderInline(text: string): ReactNode[] {
  const clean = decodeHtmlEntities(stripHtmlTags(text));
  const parts = clean.split(/(\[(?:[^\]]+)\]\((?:[^)]+)\)|\*\*[^*]+\*\*|`[^`]+`)/).filter((p): p is string => p !== undefined && p !== '');
  return parts.map((part, i) => {
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (linkMatch) {
      return <a key={i} href={linkMatch[2]} target="_blank" rel="noreferrer" className="text-primary hover:underline">{linkMatch[1]}</a>;
    }
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="rounded bg-muted px-0.5 font-mono text-[0.85em]">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export function renderMarkdown(content: string): ReactNode[] {
  const lines = content.split('\n');
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems.slice();
    nodes.push(
      <ul key={key++} className="my-1 list-inside list-disc space-y-0.5 pl-2 text-xs text-muted-foreground">
        {items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
      </ul>,
    );
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = decodeHtmlEntities(rawLine);
    const trimmed = line.trim();
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!.trim();
      if (level <= 2) {
        nodes.push(<h2 key={key++} className="mt-5 border-b border-border/40 pb-1 text-sm font-semibold first:mt-0">{renderInline(text)}</h2>);
      } else if (level <= 4) {
        nodes.push(<h3 key={key++} className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70">{renderInline(text)}</h3>);
      } else {
        nodes.push(<p key={key++} className="text-xs text-muted-foreground">{renderInline(text)}</p>);
      }
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      listItems.push(trimmed.slice(2));
    } else if (trimmed !== '') {
      flushList();
      nodes.push(<p key={key++} className="text-xs text-muted-foreground">{renderInline(trimmed)}</p>);
    } else {
      flushList();
    }
  }
  flushList();
  return nodes;
}
