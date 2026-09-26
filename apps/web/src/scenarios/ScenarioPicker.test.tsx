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
  },
];

describe('ScenarioPicker', () => {
  it('offers each prospect with her role and difficulty, one selected', () => {
    render(
      <ScenarioPicker
        scenarios={scenarios}
        selectedId="easy-ops-manager"
        onSelect={vi.fn()}
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
        disabled
      />,
    );
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
  });
});
