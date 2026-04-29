import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Claude } from './index';

function makeFetchStub() {
  return vi.fn(async () => {
    return new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
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

describe('Claude page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeFetchStub());
  });

  it('renders all 8 tab labels', () => {
    wrap(<Claude />);
    expect(screen.getByRole('heading', { name: 'Claude' })).toBeInTheDocument();
    for (const label of ['设置', 'MCP', 'Skills', 'Rules', '指令', '插件', '模型路由', '版本']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
  });
});
