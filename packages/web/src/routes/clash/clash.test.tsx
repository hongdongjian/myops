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
        '/api/clash/resources': { list: [], icon: [] },
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
});
