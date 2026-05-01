import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it('renders running', () => {
    render(<StatusBadge running />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });
  it('renders stopped', () => {
    render(<StatusBadge running={false} />);
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });
});
