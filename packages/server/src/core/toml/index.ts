// Minimal TOML helpers ported from Go (internal/app/codex_settings_handlers.go).
// These manipulate TOML content as text without a parser to preserve user formatting.

export function parseTomlSection(line: string): { section: string; ok: boolean } {
  if (!line.startsWith('[') || !line.endsWith(']')) return { section: '', ok: false };
  if (line.startsWith('[[')) return { section: '', ok: false };
  const section = line.slice(1, -1).trim();
  if (section === '') return { section: '', ok: false };
  return { section, ok: true };
}

export function parseTomlKeyValue(line: string): { key: string; value: string; ok: boolean } {
  if (line === '' || line.startsWith('#')) return { key: '', value: '', ok: false };
  const index = line.indexOf('=');
  if (index <= 0) return { key: '', value: '', ok: false };
  const key = line.slice(0, index).trim();
  if (key === '') return { key: '', value: '', ok: false };
  return { key, value: line.slice(index + 1), ok: true };
}

export function leadingWhitespace(line: string): string {
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c !== ' ' && c !== '\t') return line.slice(0, i);
  }
  return line;
}

function insertLine(lines: string[], indexIn: number, line: string): string[] {
  let index = indexIn;
  if (index < 0) index = 0;
  if (index > lines.length) index = lines.length;
  const result = lines.slice();
  result.splice(index, 0, line);
  return result;
}

function quoteString(value: string): string {
  // Mirror Go's strconv.Quote: produces a Go-syntax double-quoted string with
  // backslash escapes for special characters. For TOML purposes we use the
  // same set of escapes that JSON / Go share.
  return JSON.stringify(value);
}

export function setTomlValue(
  content: string,
  section: string,
  key: string,
  value: string,
  addIfMissing: boolean,
): { content: string; changed: boolean } {
  let lines = content.split('\n');
  let activeSection = '';
  let sectionStart = -1;
  let sectionEnd = lines.length;
  let keyIndex = -1;

  for (let index = 0; index < lines.length; index++) {
    const trimmed = (lines[index] ?? '').trim();
    const sec = parseTomlSection(trimmed);
    if (sec.ok) {
      if (activeSection === section && sectionEnd === lines.length) {
        sectionEnd = index;
      }
      activeSection = sec.section;
      if (activeSection === section && sectionStart === -1) {
        sectionStart = index;
      }
      continue;
    }
    if (activeSection !== section) continue;
    const kv = parseTomlKeyValue(trimmed);
    if (kv.ok && kv.key === key) {
      keyIndex = index;
      break;
    }
  }

  if (keyIndex >= 0) {
    const prefix = leadingWhitespace(lines[keyIndex] ?? '');
    lines[keyIndex] = `${prefix}${key} = ${value}`;
    return { content: lines.join('\n'), changed: true };
  }

  if (!addIfMissing) {
    return { content: lines.join('\n'), changed: false };
  }

  if (section === '') {
    let insertAt = 0;
    for (let index = 0; index < lines.length; index++) {
      const trimmed = (lines[index] ?? '').trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const sec = parseTomlSection(trimmed);
      if (sec.ok) {
        insertAt = index;
        break;
      }
      insertAt = index + 1;
    }
    lines = insertLine(lines, insertAt, `${key} = ${value}`);
    return { content: lines.join('\n'), changed: true };
  }

  if (sectionStart === -1) {
    if (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() !== '') {
      lines.push('');
    }
    lines.push(`[${section}]`);
    lines.push(`${key} = ${value}`);
    return { content: lines.join('\n'), changed: true };
  }

  const insertAt = sectionEnd;
  lines = insertLine(lines, insertAt, `${key} = ${value}`);
  return { content: lines.join('\n'), changed: true };
}

export function setTomlStringValue(
  content: string,
  section: string,
  key: string,
  value: string,
  addIfMissing: boolean,
): { content: string; changed: boolean } {
  return setTomlValue(content, section, key, quoteString(value), addIfMissing);
}

export function setTomlRawValue(
  content: string,
  section: string,
  key: string,
  value: string,
  addIfMissing: boolean,
): { content: string; changed: boolean } {
  if (value.trim() === '') return { content, changed: false };
  return setTomlValue(content, section, key, value, addIfMissing);
}

export function formatTomlInlineTable(values: Record<string, string>): string {
  const keys = Object.keys(values).sort();
  if (keys.length === 0) return '{}';
  const parts = keys.map((k) => `${quoteString(k)} = ${quoteString(values[k] ?? '')}`);
  return `{ ${parts.join(', ')} }`;
}

export function stripTomlInlineComment(value: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\') {
      escaped = inDouble && !escaped;
      continue;
    }
    if (char === '"') {
      if (!inSingle && !escaped) inDouble = !inDouble;
    } else if (char === "'") {
      if (!inDouble) inSingle = !inSingle;
    } else if (char === '#') {
      if (!inSingle && !inDouble) return value.slice(0, index);
    }
    escaped = false;
  }
  return value;
}

export function findTomlStringValue(content: string, section: string, key: string): { value: string; ok: boolean } {
  const lines = content.split('\n');
  let activeSection = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const sec = parseTomlSection(trimmed);
    if (sec.ok) {
      activeSection = sec.section;
      continue;
    }
    if (activeSection !== section) continue;
    const kv = parseTomlKeyValue(trimmed);
    if (!kv.ok || kv.key !== key) continue;
    const value = stripTomlInlineComment(kv.value).trim();
    if (value === '') return { value: '', ok: true };
    if (value.startsWith('"')) {
      try {
        return { value: JSON.parse(value) as string, ok: true };
      } catch {
        // fall through to literal
      }
    }
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      return { value: value.slice(1, -1), ok: true };
    }
    return { value, ok: true };
  }
  return { value: '', ok: false };
}

export function hasSectionInToml(content: string, section: string): boolean {
  for (const line of content.split('\n')) {
    const sec = parseTomlSection(line.trim());
    if (sec.ok && sec.section === section) return true;
  }
  return false;
}

export function removeTomlSection(content: string, section: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inTarget = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const sec = parseTomlSection(trimmed);
    if (sec.ok) {
      inTarget = sec.section === section;
      if (inTarget) continue;
    }
    if (!inTarget) result.push(line);
  }
  while (result.length > 0 && (result[result.length - 1] ?? '').trim() === '') {
    result.pop();
  }
  if (result.length > 0) result.push('');
  return result.join('\n');
}

export function removeTomlKeyFromSection(content: string, section: string, key: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let activeSection = '';
  for (const line of lines) {
    const trimmed = line.trim();
    const sec = parseTomlSection(trimmed);
    if (sec.ok) {
      activeSection = sec.section;
      result.push(line);
      continue;
    }
    if (activeSection === section) {
      const kv = parseTomlKeyValue(trimmed);
      if (kv.ok && kv.key === key) continue;
    }
    result.push(line);
  }
  return result.join('\n');
}

export function removeTomlRootKey(content: string, key: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const sec = parseTomlSection(trimmed);
    if (sec.ok) {
      inSection = true;
      result.push(line);
      continue;
    }
    if (inSection) {
      result.push(line);
      continue;
    }
    const kv = parseTomlKeyValue(trimmed);
    if (kv.ok && kv.key === key) continue;
    result.push(line);
  }
  return result.join('\n');
}

export function syncTomlExistingKeysFromTemplate(homeContent: string, templateContent: string): string {
  let updated = homeContent;
  const lines = templateContent.split('\n');
  let activeSection = '';
  for (const line of lines) {
    const trimmed = line.trim();
    const sec = parseTomlSection(trimmed);
    if (sec.ok) {
      activeSection = sec.section;
      continue;
    }
    const kv = parseTomlKeyValue(trimmed);
    if (!kv.ok) continue;
    const value = stripTomlInlineComment(kv.value).trim();
    if (value === '') continue;
    const r = setTomlRawValue(updated, activeSection, kv.key, value, true);
    updated = r.content;
  }
  return updated;
}
