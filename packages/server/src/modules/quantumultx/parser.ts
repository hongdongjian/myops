import type { QxGroup } from './schema.js';

const TARGET_SECTIONS: Record<string, Exclude<QxGroup, 'images'>> = {
  general: 'general',
  task_local: 'task_local',
  rewrite_remote: 'rewrite_remote',
  http_backend: 'http_backend',
  filter_remote: 'filter_remote',
  server_remote: 'server_remote',
};

const URL_RE = /https?:\/\/[^\s,"'<>]+/gi;
const IMG_URL_RE = /img-url\s*=\s*(https?:\/\/[^\s,"'<>]+)/gi;
const GENERAL_KEEP_EXT = /\.(js|conf|list|yaml|yml|txt|snippet|sgmodule)(\?|$)/i;
const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?|$)/i;

export interface ParsedResources {
  general: string[];
  task_local: string[];
  rewrite_remote: string[];
  http_backend: string[];
  filter_remote: string[];
  server_remote: string[];
  images: string[];
}

export function parseQxConf(text: string): ParsedResources {
  const result: ParsedResources = {
    general: [],
    task_local: [],
    rewrite_remote: [],
    http_backend: [],
    filter_remote: [],
    server_remote: [],
    images: [],
  };
  const seen: Record<keyof ParsedResources, Set<string>> = {
    general: new Set(),
    task_local: new Set(),
    rewrite_remote: new Set(),
    http_backend: new Set(),
    filter_remote: new Set(),
    server_remote: new Set(),
    images: new Set(),
  };

  let currentSection: string | null = null;
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([a-zA-Z0-9_]+)\]\s*$/);
    if (sectionMatch && sectionMatch[1]) {
      currentSection = sectionMatch[1];
      continue;
    }

    if (line.startsWith('#') || line.startsWith('//')) continue;

    const target = currentSection ? TARGET_SECTIONS[currentSection] : null;

    if (target) {
      const urls = line.match(URL_RE);
      if (urls) {
        for (const url of urls) {
          const cleaned = stripTrailing(url);
          const p = pathOf(cleaned);
          // Route image-extension URLs to images group regardless of section
          if (IMAGE_EXT.test(p)) {
            if (!seen.images.has(cleaned)) {
              seen.images.add(cleaned);
              result.images.push(cleaned);
            }
            continue;
          }
          // For [general], only keep resource-like URLs; skip probes/APIs
          if (target === 'general' && !GENERAL_KEEP_EXT.test(p)) continue;
          if (!seen[target].has(cleaned)) {
            seen[target].add(cleaned);
            result[target].push(cleaned);
          }
        }
      }
    }

    let m: RegExpExecArray | null;
    IMG_URL_RE.lastIndex = 0;
    while ((m = IMG_URL_RE.exec(line)) !== null) {
      const url = stripTrailing(m[1] ?? '');
      if (url && !seen.images.has(url)) {
        seen.images.add(url);
        result.images.push(url);
      }
    }
  }

  for (const g of ['general', 'task_local', 'rewrite_remote', 'http_backend', 'filter_remote', 'server_remote'] as const) {
    result[g] = result[g].filter((u) => !result.images.includes(u) || !looksLikeImage(u));
  }

  return result;
}

function stripTrailing(url: string): string {
  return url.replace(/[),.;]+$/, '');
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function looksLikeImage(url: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?|$)/i.test(url);
}

export function urlToFilename(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const base = pathname.split('/').filter(Boolean).pop() || 'file';
  return sanitizeFilename(decodeURIComponent(base));
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-]/g, '_').slice(0, 120) || 'file';
}
