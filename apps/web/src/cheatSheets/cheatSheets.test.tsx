import type { CheatSheetDetail } from '@ccc/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { CheatSheetPage } from './CheatSheetPage.tsx';
import { CheatSheetsPage } from './CheatSheetsPage.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const HEALTH = { ok: true, db: { ok: true, latencyMs: 1 } };
const ID = '5c1e0a4e-2b1f-4f55-9a0c-6d3f1c1e8a10';
const BRIEF =
  'Sarah Patel, Head of Estates at Carewell, 14 care homes in Yorkshire. Objective: a 20-minute call.';

const SHEET: CheatSheetDetail = {
  id: ID,
  title: 'Sarah Patel, Carewell',
  goal: 'A 20-minute call on site-by-site monitoring',
  createdAt: '2026-09-29T09:00:00.000Z',
  brief: BRIEF,
  costUsd: 0.05,
  sheet: {
    title: 'Sarah Patel, Carewell',
    goal: 'A 20-minute call on site-by-site monitoring',
    opener: ["Hi Sarah, it's Sam from WattGuard.", 'Can I have thirty seconds on why I rang?'],
    reason: 'Care groups tell me the gas bill doubled and nobody could say which home.',
    questions: ['How do you see energy home by home today?', 'What does the board ask you?'],
    theirQuestions: [
      { they: 'What is it exactly?', you: 'Energy data for every site, half-hourly.' },
    ],
    objections: [{ they: 'Send me an email.', you: 'Happy to. What should it cover?' }],
    valueLines: [{ they: 'Bills up, no idea why', you: 'WattGuard shows which home uses what.' }],
    close: ['Would Thursday at ten work for twenty minutes on Teams?'],
    voicemail: "Sarah, it's Sam from WattGuard about the winter gas bills.",
  },
};

describe('CheatSheetsPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists the sheets, and writes a new one from a profile, then opens it', async () => {
    const posts: Array<[string, unknown]> = [];
    let answer: (value: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (urlOf(input) === '/api/health') return Promise.resolve(json(200, HEALTH));
      if (init?.method === 'POST') {
        posts.push([urlOf(input), JSON.parse(init.body as string)]);
        // Held, as Claude takes half a minute.
        return new Promise((resolve) => (answer = resolve));
      }
      return Promise.resolve(
        json(200, {
          sheets: [{ id: ID, title: SHEET.title, goal: SHEET.goal, createdAt: SHEET.createdAt }],
        }),
      );
    });
    const location = memoryLocation({ path: '/cheat-sheets', record: true });
    render(
      <Router hook={location.hook}>
        <CheatSheetsPage />
      </Router>,
    );
    const list = await screen.findByRole('list', { name: 'Cheat sheets' });
    const [card] = within(list).getAllByRole('link');
    expect(card).toHaveAttribute('href', `/cheat-sheets/${ID}`);
    expect(card).toHaveTextContent('Sarah Patel, Carewell');
    expect(card).toHaveTextContent('Goal: A 20-minute call on site-by-site monitoring');

    fireEvent.click(screen.getByRole('button', { name: 'Create cheat sheet' }));
    const dialog = screen.getByRole('dialog', { name: 'Create a cheat sheet' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: BRIEF } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create cheat sheet' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'Writing your cheat sheet… about half a minute.',
    );
    expect(posts).toEqual([['/api/cheat-sheets', { brief: BRIEF }]]);

    answer(json(201, { id: ID }));
    await waitFor(() => expect(location.history).toContain(`/cheat-sheets/${ID}`));
  });

  it('says so when there are none yet', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
      Promise.resolve(
        urlOf(input) === '/api/health' ? json(200, HEALTH) : json(200, { sheets: [] }),
      ),
    );
    render(
      <Router hook={memoryLocation({ path: '/cheat-sheets' }).hook}>
        <CheatSheetsPage />
      </Router>,
    );
    expect(await screen.findByText(/No cheat sheets yet/)).toBeInTheDocument();
  });
});

describe('CheatSheetPage', () => {
  afterEach(() => vi.restoreAllMocks());

  const renderSheet = (
    location = memoryLocation({ path: `/cheat-sheets/${ID}`, record: true }),
  ) => {
    render(
      <Router hook={location.hook}>
        <CheatSheetPage id={ID} />
      </Router>,
    );
    return location;
  };

  it('lays the call out to read at a glance: the call in order, and what to say back', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
      Promise.resolve(urlOf(input) === '/api/health' ? json(200, HEALTH) : json(200, SHEET)),
    );
    renderSheet();
    expect(
      await screen.findByRole('heading', { name: 'Sarah Patel, Carewell' }),
    ).toBeInTheDocument();
    expect(screen.getByText('A 20-minute call on site-by-site monitoring')).toBeInTheDocument();
    const section = (name: RegExp) => screen.getByRole('heading', { name }).closest('section')!;
    expect(section(/Open/)).toHaveTextContent("“Hi Sarah, it's Sam from WattGuard.”");
    expect(section(/Why I'm calling/)).toHaveTextContent('nobody could say which home');
    expect(within(section(/Ask/)).getAllByRole('listitem')).toHaveLength(2);
    expect(section(/Close/)).toHaveTextContent('Thursday at ten');
    expect(section(/If they push back/)).toHaveTextContent('“Send me an email.”');
    expect(section(/If they push back/)).toHaveTextContent('Happy to. What should it cover?');
    expect(section(/If they ask/)).toHaveTextContent('Energy data for every site');
    expect(section(/When they name a problem/)).toHaveTextContent('which home uses what');
    expect(section(/Voicemail/)).toHaveTextContent('about the winter gas bills');
    expect(screen.getByText(/Written from your profile by Claude for \$0\.05/)).toBeInTheDocument();

    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalled();
  });

  it('deletes the sheet once asked to, and goes back to the list', async () => {
    const deletes: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (urlOf(input) === '/api/health') return Promise.resolve(json(200, HEALTH));
      if (init?.method === 'DELETE') {
        deletes.push(urlOf(input));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(json(200, SHEET));
    });
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const location = renderSheet();
    const remove = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(remove);
    expect(confirm).toHaveBeenCalledWith('Delete the cheat sheet for Sarah Patel, Carewell?');
    expect(deletes).toEqual([]);
    fireEvent.click(remove);
    await waitFor(() => expect(location.history).toContain('/cheat-sheets'));
    expect(deletes).toEqual([`/api/cheat-sheets/${ID}`]);
  });

  it('says so when the sheet does not exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
      Promise.resolve(
        urlOf(input) === '/api/health'
          ? json(200, HEALTH)
          : json(404, { error: 'No such cheat sheet.' }),
      ),
    );
    renderSheet();
    expect(await screen.findByText('No such cheat sheet.')).toBeInTheDocument();
  });
});
