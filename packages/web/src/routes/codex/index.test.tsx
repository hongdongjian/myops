import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Codex } from './index';

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

describe('Codex page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeFetchStub());
  });

  it('renders all 5 tab labels', () => {
    wrap(<Codex />);
    expect(screen.getByRole('heading', { name: 'Codex' })).toBeInTheDocument();
    for (const label of ['Version', 'Settings', 'Providers', 'MCP', 'Skills']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
  });
});
