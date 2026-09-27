import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddProspectDialog } from './AddProspectDialog.tsx';
import { EXAMPLES } from './examples.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ADDED = {
  scenario: {
    id: 'rachel-byrne-4f2a9c',
    version: 1,
    title: 'Energy broker with an in-house dev team',
    difficulty: 'hard',
    winCondition: 'Agrees to a 20-minute call at a specific day and time',
    prospect: { name: 'Rachel Byrne', role: 'Operations Director', company: 'Voltline Energy' },
    custom: true,
  },
  voice: 'chosen',
};

describe('AddProspectDialog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends the description, says it is writing her, and hands her back', async () => {
    let answer = (_res: Response) => {};
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const onAdded = vi.fn();
    render(<AddProspectDialog onClose={vi.fn()} onAdded={onAdded} />);
    const dialog = screen.getByRole('dialog', { name: 'Add someone to call' });
    const box = screen.getByRole('textbox', { name: 'Who are you calling?' });
    expect(box).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Add her' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: EXAMPLES[0] }));
    expect(box).toHaveValue(EXAMPLES[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Add her' }));

    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Writing her…');
    expect(box).toBeDisabled();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/scenarios');
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ description: EXAMPLES[0] }),
    });

    await act(async () => {
      answer(json(201, ADDED));
      await Promise.resolve();
    });
    expect(onAdded).toHaveBeenCalledWith(ADDED);
  });

  it('shows why she could not be added, and lets you try again', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(502, { error: 'Claude is overloaded. Try again shortly.' }),
    );
    render(<AddProspectDialog onClose={vi.fn()} onAdded={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'A tough broker who hates cold calls.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add her' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Claude is overloaded. Try again shortly.',
    );
    expect(screen.getByRole('button', { name: 'Add her' })).toBeEnabled();
  });

  it('closes with Cancel or Escape', () => {
    const onClose = vi.fn();
    render(<AddProspectDialog onClose={onClose} onAdded={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
