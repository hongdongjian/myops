import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Sync } from './index';

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

describe('Sync page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeFetchStub());
  });

  it('renders 3 sub-tabs', () => {
    wrap(<Sync />);
    expect(screen.getByRole('heading', { name: '同步' })).toBeInTheDocument();
    for (const label of ['Clash', 'Cloudreve', 'Immich']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
  });
});
