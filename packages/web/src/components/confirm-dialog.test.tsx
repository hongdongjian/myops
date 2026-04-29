import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmDialog } from './confirm-dialog';
import { Button } from './ui/button';

describe('ConfirmDialog', () => {
  it('fires onConfirm when confirm clicked', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        trigger={<Button>open</Button>}
        title="Are you sure?"
        description="desc"
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByText('open'));
    await waitFor(() => expect(screen.getByText('Are you sure?')).toBeInTheDocument());
    fireEvent.click(screen.getByText('确认'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});
