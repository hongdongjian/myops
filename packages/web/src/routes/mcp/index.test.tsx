import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Mcp } from './index';

function makeFetchStub() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const ok = (data: unknown) =>
      new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    if (url.startsWith('/api/mcp/xiaohongshu/status')) {
      return ok({
        process: { running: false, pid: 0 },
        health: { healthy: false, state: 'ERROR' },
        auth: { hasCookie: false, actionLabel: '登录' },
        package: { loginBinaryExists: true, serverBinaryExists: true },
      });
    }
    if (url.startsWith('/api/mcp/xiaohongshu/autostart')) return ok({ enabled: false });
    if (url.startsWith('/api/mcp/xiaohongshu/logs')) return ok({ content: 'mcp log' });
    return ok({});
  });
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MCP page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeFetchStub());
  });

  it('renders mcp page with action buttons', async () => {
    wrap(<Mcp />);
    expect(screen.getByText(/小红书 MCP Server/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启动' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '注册到 Claude' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('未启动')).toBeInTheDocument());
  });

  it('shows MCP log content from log panel', async () => {
    wrap(<Mcp />);
    await waitFor(() => expect(screen.getByText('mcp log')).toBeInTheDocument());
  });
});
