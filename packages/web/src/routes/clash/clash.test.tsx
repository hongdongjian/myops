import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClashTab } from './clash';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Clash subscriptions', () => {
  it('provides both formats using one key and displays the conversion report', async () => {
    const fetchStub = vi.fn(async (url: string) => {
      const payloads: Record<string, unknown> = {
        '/api/clash/config': { api_key: 'shared&key', custom_proxies: [], custom_rules: [] },
        '/api/clash/template': { content: '# template' },
        '/api/clash/resources': {
          list: [{ url: 'https://rules.example.com/demo.list', filename: 'demo.list', source: 'remote', updatedAt: 1 }],
          icon: [{ url: 'https://icons.example.com/YouTube.png', filename: 'You Tube.png', source: 'remote', updatedAt: 1 }],
        },
        '/api/clash/groups': { groups: [] },
        '/api/clash/quantumultx/report': {
          stats: { nodes: 3, groups: 2, rules: 5, skippedNodes: 1, skippedRules: 2 },
          issues: [{ code: 'node:hysteria2', message: '不支持节点协议 hysteria2', count: 1 }],
        },
      };
      return new Response(JSON.stringify({ success: true, data: payloads[url] ?? {} }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchStub);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={queryClient}><ClashTab /></QueryClientProvider>);
    try {
      await waitFor(() => expect(screen.getByLabelText('Clash 订阅地址')).toHaveValue(window.location.origin + '/api/clash/subscribe?api-key=shared%26key'));
      expect(screen.getByLabelText('Quantumult X 订阅地址')).toHaveValue(window.location.origin + '/api/qx/subscribe?api-key=shared%26key');
      expect(await screen.findByRole('link', { name: '本地: ' + window.location.origin + '/api/static/icon/You%20Tube.png?api-key=shared%26key' })).toHaveAttribute('href', '/api/static/icon/You%20Tube.png?api-key=shared%26key');
      expect(screen.getByRole('link', { name: '本地: ' + window.location.origin + '/api/clash/static/list/demo.list?api-key=shared%26key' })).toHaveAttribute('href', '/api/clash/static/list/demo.list?api-key=shared%26key');
      expect(fetchStub.mock.calls.some(([url]) => url.includes('/report'))).toBe(false);
      await userEvent.setup().click(screen.getByRole('button', { name: '检查转换' }));
      expect(await screen.findByText('3 个节点')).toBeInTheDocument();
      expect(screen.getByText('跳过 1 个节点')).toBeInTheDocument();
      expect(screen.getByText('不支持节点协议 hysteria2')).toBeInTheDocument();
      expect(fetchStub.mock.calls.some(([url]) => url.startsWith('/api/qx/'))).toBe(false);
    } finally {
      view.unmount();
      queryClient.clear();
    }
  });

  it('manually saves a key, preserves settings, and updates subscription and resource links', async () => {
    let config = {
      api_key: 'old-key',
      clash_public_base_url: 'https://clash.example.com',
      qx_public_base_url: 'https://qx.example.com',
      custom_proxies: [{ name: 'Keep', type: 'ss' }], custom_rules: [],
    };
    const savedBodies: Record<string, unknown>[] = [];
    const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/clash/config' && init?.method === 'PUT') {
        savedBodies.push(JSON.parse(String(init.body)));
        if (savedBodies.length === 1) {
          return new Response(JSON.stringify({ success: false, error: '保存失败' }), { status: 500 });
        }
        config = JSON.parse(String(init.body));
      }
      const payloads: Record<string, unknown> = {
        '/api/clash/config': config,
        '/api/clash/template': { content: '# template' },
        '/api/clash/resources': {
          list: [{ url: 'https://rules.example.com/demo.list', filename: 'demo.list', source: 'remote', updatedAt: 1 }],
          icon: [{ url: 'https://icons.example.com/demo.png', filename: 'demo.png', source: 'remote', updatedAt: 1 }],
        },
        '/api/clash/groups': { groups: [] },
      };
      return new Response(JSON.stringify({ success: true, data: payloads[url] ?? {} }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchStub);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={queryClient}><ClashTab /></QueryClientProvider>);
    try {
      await waitFor(() => expect(screen.getByLabelText('Clash 订阅地址')).toHaveValue('https://clash.example.com/api/clash/subscribe?api-key=old-key'));
      const input = screen.getByLabelText('手动设置密钥');
      const save = screen.getByRole('button', { name: '保存密钥' });
      expect(input).toHaveAttribute('type', 'password');
      expect(input).toHaveValue('');
      expect(save).toBeDisabled();
      const user = userEvent.setup();
      await user.type(input, '   {Enter}');
      expect(save).toBeDisabled();
      expect(savedBodies).toHaveLength(0);
      await user.clear(input);
      await user.type(input, ' custom&key/# {Enter}');
      await waitFor(() => expect(savedBodies).toHaveLength(1));
      await waitFor(() => expect(save).toBeEnabled());
      expect(input).toHaveValue(' custom&key/# ');
      expect(config.api_key).toBe('old-key');
      await user.click(save);
      const query = '?api-key=' + encodeURIComponent('custom&key/#');
      await waitFor(() => expect(screen.getByLabelText('Clash 订阅地址')).toHaveValue('https://clash.example.com/api/clash/subscribe' + query));
      expect(screen.getByLabelText('Quantumult X 订阅地址')).toHaveValue('https://qx.example.com/api/qx/subscribe' + query);
      expect(screen.getByRole('link', { name: '本地: ' + window.location.origin + '/api/static/icon/demo.png' + query })).toHaveAttribute('href', '/api/static/icon/demo.png' + query);
      expect(screen.getByRole('link', { name: '本地: ' + window.location.origin + '/api/clash/static/list/demo.list' + query })).toHaveAttribute('href', '/api/clash/static/list/demo.list' + query);
      expect(savedBodies[1]).toEqual({
        api_key: 'custom&key/#', clash_public_base_url: 'https://clash.example.com', qx_public_base_url: 'https://qx.example.com',
        custom_proxies: [{ name: 'Keep', type: 'ss' }], custom_rules: [],
      });
      await waitFor(() => expect(input).toHaveValue(''));
      expect(save).toBeDisabled();
      expect(screen.getByRole('button', { name: '轮换密钥' })).toBeEnabled();
    } finally {
      view.unmount();
      queryClient.clear();
    }
  });

  it('saves separate public addresses, updates subscription links, and preserves drafts after a failed save', async () => {
    let config = {
      api_key: 'shared&key',
      clash_public_base_url: 'https://old-clash.example.com',
      qx_public_base_url: 'https://old-qx.example.com',
      custom_proxies: [],
      custom_rules: [],
    };
    let saves = 0;
    const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/clash/config' && init?.method === 'PUT') {
        saves++;
        if (saves === 1) {
          return new Response(JSON.stringify({ success: false, error: '保存失败' }), { status: 500 });
        }
        const next = JSON.parse(String(init.body));
        expect(next.api_key).toBe('shared&key');
        expect(next.custom_proxies).toEqual([]);
        expect(next.custom_rules).toEqual([]);
        config = next;
      }
      const payloads: Record<string, unknown> = {
        '/api/clash/config': config,
        '/api/clash/template': { content: '# template' },
        '/api/clash/resources': { list: [], icon: [] },
        '/api/clash/groups': { groups: [] },
      };
      return new Response(JSON.stringify({ success: true, data: payloads[url] ?? {} }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchStub);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={queryClient}><ClashTab /></QueryClientProvider>);
    try {
      const clashInput = screen.getByLabelText('Clash 公网地址');
      const qxInput = screen.getByLabelText('Quantumult X 公网地址');
      await waitFor(() => expect(clashInput).toHaveValue(config.clash_public_base_url));
      expect(qxInput).toHaveValue(config.qx_public_base_url);
      const user = userEvent.setup();
      await user.clear(clashInput);
      await user.type(clashInput, ' https://clash.example.com:20443/ ');
      await user.clear(qxInput);
      await user.type(qxInput, ' https://qx.example.com:20443/ ');
      const save = screen.getByRole('button', { name: '保存公网地址' });
      await user.click(save);
      await waitFor(() => expect(save).toBeEnabled());
      expect(clashInput).toHaveValue(' https://clash.example.com:20443/ ');
      expect(qxInput).toHaveValue(' https://qx.example.com:20443/ ');
      await user.click(save);
      await waitFor(() => expect(screen.getByLabelText('Clash 订阅地址')).toHaveValue('https://clash.example.com:20443/api/clash/subscribe?api-key=shared%26key'));
      expect(screen.getByLabelText('Quantumult X 订阅地址')).toHaveValue('https://qx.example.com:20443/api/qx/subscribe?api-key=shared%26key');
      expect(saves).toBe(2);
      expect(config.clash_public_base_url).toBe('https://clash.example.com:20443/');
      expect(config.qx_public_base_url).toBe('https://qx.example.com:20443/');
      await waitFor(() => expect(save).toBeDisabled());
    } finally {
      view.unmount();
      queryClient.clear();
    }
  });
});
