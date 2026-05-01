import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelSelect } from './model-select';

describe('ModelSelect', () => {
  it('renders placeholder', () => {
    render(<ModelSelect placeholder="输入模型" />);
    expect(screen.getByPlaceholderText('输入模型')).toBeInTheDocument();
  });
});
