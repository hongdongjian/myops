import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Copilot } from './index';

function makeFetchStub() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const ok = (data: unknown) =>
      new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    if (url.startsWith('/api/copilot/status')) {
      return ok({
        process: { name: 'copilot-api', running: true, pid: 1234 },
        health: { healthy: true, state: 'ACTIVE' },
        version: { installed: true, current: '1.2.3', latest: '1.2.3', canUpgrade: false, upgradeTarget: '' },
        auth: { accountCount: 0, hasToken: true, currentAccount: { id: 'a', login: 'alice', current: true, createdAt: 0, lastUsedAt: 0 } },
        sourceUrl: 'https://example.com',
      });
    }
    if (url.startsWith('/api/copilot/usage')) {
      return ok({ unlimited: false, used: 10, total: 100, remaining: 90, percentUsed: 10 });
    }
    if (url.startsWith('/api/copilot/autostart')) return ok({ enabled: false });
    if (url.startsWith('/api/copilot/proxy')) return ok({ enabled: false, proxyURL: '' });
    if (url.startsWith('/api/copilot/logs')) return ok({ content: 'log line 1' });
    if (url.startsWith('/api/copilot/accounts')) return ok({ accounts: [], currentAccountId: '' });
    if (url.startsWith('/api/copilot/config/sync-status')) return ok({ synced: true, localExists: true });
    if (url.startsWith('/api/copilot/config')) return ok({ path: 'conf/copilot-api/config.json', content: '{}', exists: true });
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

describe('Copilot page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeFetchStub());
  });

  it('renders copilot tabs and console content', async () => {
    wrap(<Copilot />);
    expect(screen.getByRole('heading', { name: 'Copilot' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Console' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Accounts' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Config' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('1.2.3').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/copilot-api/).length).toBeGreaterThan(0);
  });

  it('shows running status badge', async () => {
    wrap(<Copilot />);
    await waitFor(() => expect(screen.getByText('Running')).toBeInTheDocument());
  });
});
