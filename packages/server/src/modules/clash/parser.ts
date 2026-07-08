import YAML from 'yaml';
import type { ClashResourceGroup } from './schema.js';

export interface ParsedClashResources {
  list: string[];
  icon: string[];
}

const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?|$)/i;
const LIST_EXT = /\.(list|yaml|yml|txt)(\?|$)/i;

interface NamedEntry {
  name: string;
  url?: string;
  icon?: string;
}

export function parseClashYaml(text: string): ParsedClashResources {
  const out: ParsedClashResources = { list: [], icon: [] };
  if (!text.trim()) return out;
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch {
    return out;
  }
  if (!doc || typeof doc !== 'object') return out;
  const d = doc as Record<string, unknown>;

  const listSeen = new Set<string>();
  const iconSeen = new Set<string>();

  const pushList = (url: string) => {
    const u = url.trim();
    if (!u || listSeen.has(u)) return;
    listSeen.add(u);
    out.list.push(u);
  };
  const pushIcon = (url: string) => {
    const u = url.trim();
    if (!u || iconSeen.has(u)) return;
    iconSeen.add(u);
    out.icon.push(u);
  };

  // proxy-providers (e.g. 机场订阅) are intentionally excluded: mirroring them locally
  // strips upstream response headers (Subscription-Userinfo) and adds a manual refresh
  // step, so Clash should always fetch those URLs directly.
  const node = d['rule-providers'];
  if (node && typeof node === 'object') {
    for (const entry of Object.values(node as Record<string, unknown>)) {
      if (entry && typeof entry === 'object') {
        const url = (entry as Record<string, unknown>).url;
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) pushList(url);
      }
    }
  }

  const groups = d['proxy-groups'];
  if (Array.isArray(groups)) {
    for (const g of groups) {
      if (g && typeof g === 'object') {
        const icon = (g as Record<string, unknown>).icon;
        if (typeof icon === 'string' && /^https?:\/\//i.test(icon) && IMAGE_EXT.test(icon)) pushIcon(icon);
      }
    }
  }

  return out;
}

export function extractGroupNames(text: string): string[] {
  if (!text.trim()) return [];
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch {
    return [];
  }
  if (!doc || typeof doc !== 'object') return [];
  const groups = (doc as Record<string, unknown>)['proxy-groups'];
  if (!Array.isArray(groups)) return [];
  const names: string[] = [];
  for (const g of groups) {
    if (g && typeof g === 'object') {
      const name = (g as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) names.push(name);
    }
  }
  return names;
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

export function classifyUrl(url: string): ClashResourceGroup {
  return IMAGE_EXT.test(url) ? 'icon' : 'list';
}

export function isListUrl(url: string): boolean {
  return LIST_EXT.test(url);
}
