import { describe, it, expect } from 'vitest';
import { parseQxConf, urlToFilename } from './parser.js';

const SAMPLE = `
[general]
server_check_url = http://www.gstatic.com/generate_204
resource_parser_url = https://cdn.example.com/scripts/parser.js
geo_location_checker = https://api.example.com/cn?json, https://cdn.example.com/scripts/geo.js
profile_img_url = https://cdn.example.com/icons/profile.png

[task_local]
# > comment
event-interaction https://raw.githubusercontent.com/foo/bar/main/ui.js, tag=UI, img-url=arrowtriangle.right.square.system, enabled=true
event-interaction https://example.com/ip.js, tag=IP, img-url=https://cdn.example.com/icons/ip.png

[rewrite_remote]
https://example.com/rewrite.conf, tag=R1, img-url=https://cdn.example.com/icons/r1.png, update-interval=86400, enabled=true
# commented https://nope.example.com/x.conf
; disabled https://example.com/disabled.conf, tag=Off, enabled=false

[server_remote]
https://example.com/server.yaml

[http_backend]
https://example.com/backend.js, host=boxjs.com, tag=BoxJS

[filter_remote]
https://example.com/rules.list, tag=Rules, enabled=true

[mitm]
hostname = *.example.com
https://should-not-parse.example.com/x
`;

describe('parseQxConf', () => {
  it('extracts URLs from target sections only', () => {
    const r = parseQxConf(SAMPLE);
    expect(r.task_local).toEqual([
      'https://raw.githubusercontent.com/foo/bar/main/ui.js',
      'https://example.com/ip.js',
    ]);
    expect(r.rewrite_remote).toEqual([
      'https://example.com/rewrite.conf',
      'https://example.com/disabled.conf',
    ]);
    expect(r.http_backend).toEqual(['https://example.com/backend.js']);
    expect(r.filter_remote).toEqual(['https://example.com/rules.list']);
    expect(r.server_remote).toEqual(['https://example.com/server.yaml']);
    expect(r.general).toEqual([
      'https://cdn.example.com/scripts/parser.js',
      'https://cdn.example.com/scripts/geo.js',
    ]);
  });

  it('skips general URLs without resource-like extension', () => {
    const r = parseQxConf(SAMPLE);
    expect(r.general).not.toContain('http://www.gstatic.com/generate_204');
    expect(r.general).not.toContain('https://api.example.com/cn?json');
  });

  it('extracts img-url images and routes [general] PNG to images group', () => {
    const r = parseQxConf(SAMPLE);
    expect(r.images).toContain('https://cdn.example.com/icons/ip.png');
    expect(r.images).toContain('https://cdn.example.com/icons/r1.png');
    expect(r.images).toContain('https://cdn.example.com/icons/profile.png');
    expect(r.general).not.toContain('https://cdn.example.com/icons/profile.png');
  });

  it('parses URLs even on `;`-disabled lines but skips `#` comments', () => {
    const r = parseQxConf(SAMPLE);
    expect(r.rewrite_remote).not.toContain('https://nope.example.com/x.conf');
    expect(r.rewrite_remote).toContain('https://example.com/disabled.conf');
    expect(r.images).not.toContain('arrowtriangle.right.square.system');
  });

  it('skips non-target sections', () => {
    const r = parseQxConf(SAMPLE);
    expect(JSON.stringify(r)).not.toContain('should-not-parse');
  });
});

describe('urlToFilename', () => {
  it('returns basename', () => {
    expect(urlToFilename('https://example.com/a/b/file.conf')).toBe('file.conf');
  });
  it('sanitizes weird chars', () => {
    expect(urlToFilename('https://example.com/abc def.js')).toBe('abc_def.js');
  });
  it('fallback for empty path', () => {
    expect(urlToFilename('https://example.com/')).toBe('file');
  });
});
