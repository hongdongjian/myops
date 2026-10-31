import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

describe('App navigation', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens Claude by default and keeps the remaining navigation available', async () => {
    const fetchStub = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: {} }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchStub);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    try {
      expect(await screen.findByRole('heading', { name: 'Claude' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Claude/ })).toHaveAttribute('aria-current', 'page');
      expect(screen.queryByRole('link', { name: /Copilot/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /MCP/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /QuantumultX/ })).not.toBeInTheDocument();
      for (const label of ['Codex', 'Cron', 'Clash']) {
        expect(screen.getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
      }
    } finally {
      view.unmount();
      qc.clear();
    }
  });
});
