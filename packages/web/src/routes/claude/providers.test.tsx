import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClaudeProviders } from './providers';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ClaudeProviders', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/claude/providers' && !init?.method) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            activeProvider: '',
            providers: [
              {
                name: 'deepseek',
                baseUrl: 'https://api.deepseek.com/anthropic',
                token: 'sk-test',
                model: '',
                haikuModel: 'deepseek-chat',
                sonnetModel: 'deepseek-chat',
                opusModel: 'deepseek-r1',
                env: { FOO: 'bar' },
              },
            ],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('copies a provider as a new add form with a random suffix', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2345);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    wrap(<ClaudeProviders />);

    await screen.findByText('deepseek');
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    const nameInput = screen.getByDisplayValue('deepseek-3110');
    expect(nameInput).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://api.deepseek.com/anthropic')).toBeInTheDocument();
    expect(screen.getByDisplayValue('FOO')).toBeInTheDocument();
    expect(screen.getByDisplayValue('bar')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/claude/providers/add',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"name":"deepseek-3110"'),
        }),
      );
    });
  });
});
