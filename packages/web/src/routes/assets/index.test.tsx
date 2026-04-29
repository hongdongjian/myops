import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Assets } from './index';

function makeFetchStub() {
  return vi.fn(async () => {
    return new Response(JSON.stringify({ success: true, data: { home: [], project: [], homePath: '', projectPath: '' } }), {
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

describe('Assets page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeFetchStub());
  });

  it('renders three category cards', () => {
    wrap(<Assets />);
    expect(screen.getByRole('heading', { name: '资产' })).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Rules')).toBeInTheDocument();
    expect(screen.getByText('Commands')).toBeInTheDocument();
  });
});
