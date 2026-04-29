import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModelSelect } from './model-select';

describe('ModelSelect', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, data: { models: ['gpt-4o', 'claude-sonnet'] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  it('renders placeholder', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ModelSelect placeholder="选择模型" />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/选择模型|加载中/)).toBeInTheDocument();
  });
});
