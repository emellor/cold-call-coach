import type { ScenarioSummary } from '@ccc/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScenarioPicker } from './ScenarioPicker.tsx';

const scenarios: ScenarioSummary[] = [
  {
    id: 'easy-ops-manager',
    version: 1,
    title: 'Curious operations manager',
    difficulty: 'easy',
    winCondition: 'Agrees to a 20-minute call',
    prospect: { name: 'Priya Shah', role: 'Operations Manager', company: 'Northgate Bakeries' },
    custom: false,
  },
  {
    id: 'hard-facilities-manager',
    version: 1,
    title: 'Facilities manager who hates cold calls',
    difficulty: 'hard',
    winCondition: 'Agrees to a 20-minute call',
    prospect: {
      name: 'Denise Walsh',
      role: 'Head of Facilities',
      company: 'Brightwell Retail Parks',
    },
    custom: false,
  },
  {
    id: 'rachel-byrne-4f2a9c',
    version: 1,
    title: 'Energy broker with an in-house dev team',
    difficulty: 'hard',
    winCondition: 'Agrees to a 20-minute call',
    prospect: { name: 'Rachel Byrne', role: 'Operations Director', company: 'Voltline Energy' },
    custom: true,
  },
];

describe('ScenarioPicker', () => {
  it('offers each prospect with her role and difficulty, one selected', () => {
    render(
      <ScenarioPicker
        scenarios={scenarios}
        selectedId="easy-ops-manager"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByRole('group', { name: 'Who are you calling?' })).toBeInTheDocument();
    const priya = screen.getByRole('radio', { name: /Priya Shah/ });
    expect(priya).toBeChecked();
    expect(screen.getByRole('radio', { name: /Denise Walsh.*hard/ })).not.toBeChecked();
    expect(screen.getByText('Head of Facilities, Brightwell Retail Parks')).toBeInTheDocument();
  });

  it('reports the choice', () => {
    const onSelect = vi.fn();
    render(
      <ScenarioPicker
        scenarios={scenarios}
        selectedId="easy-ops-manager"
        onSelect={onSelect}
        onAdd={vi.fn()}
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Denise Walsh/ }));
    expect(onSelect).toHaveBeenCalledWith('hard-facilities-manager');
  });

  it('is locked during a call', () => {
    render(
      <ScenarioPicker
        scenarios={scenarios}
        selectedId="easy-ops-manager"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        disabled
      />,
    );
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.getByRole('button', { name: /Add new/ })).toBeDisabled();
  });

  it('marks the prospects you added, and offers to add another', () => {
    const onAdd = vi.fn();
    render(
      <ScenarioPicker
        scenarios={scenarios}
        selectedId="easy-ops-manager"
        onSelect={vi.fn()}
        onAdd={onAdd}
        disabled={false}
      />,
    );
    expect(screen.getByRole('radio', { name: /Rachel Byrne.*Added by you/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Priya Shah/ })).not.toHaveAccessibleName(
      /Added by you/,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add new/ }));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});
