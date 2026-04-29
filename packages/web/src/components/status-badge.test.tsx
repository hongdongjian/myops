import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it('renders running', () => {
    render(<StatusBadge running />);
    expect(screen.getByText('运行中')).toBeInTheDocument();
  });
  it('renders stopped', () => {
    render(<StatusBadge running={false} />);
    expect(screen.getByText('未启动')).toBeInTheDocument();
  });
});
