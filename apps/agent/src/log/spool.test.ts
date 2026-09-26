import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallLog } from '@ccc/contracts';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../test/fixtures.ts';
import type { PostResult } from './post.ts';
import { LogSpool } from './spool.ts';

const log: CallLog = {
  outcome: 'ended_by_rep',
  connectedAt: '2026-09-26T10:00:00.000Z',
  endedAt: '2026-09-26T10:05:00.000Z',
  durationMs: 300_000,
  turns: [],
  events: [],
  latency: [],
  usage: {},
};
const A = '11111111-2222-4333-8444-555555555555';
const B = '66666666-7777-4888-9999-000000000000';

async function spool() {
  const dir = await mkdtemp(join(tmpdir(), 'spool-'));
  return { dir, spool: new LogSpool(dir, silentLogger) };
}

describe('LogSpool', () => {
  it('keeps logs and sends them later, forgetting the ones that went out', async () => {
    const { dir, spool: s } = await spool();
    await s.save(A, log);
    await s.save(B, { ...log, outcome: 'timeout' });
    const answers: Record<string, PostResult> = { [A]: 'posted', [B]: 'unreachable' };
    const send = vi.fn((callId: string) => Promise.resolve(answers[callId]!));
    await expect(s.flush(send)).resolves.toEqual({ sent: 1, waiting: 1 });
    expect(send).toHaveBeenCalledWith(A, log);
    expect(await readdir(dir)).toEqual([`${B}.json`]);

    answers[B] = 'rejected'; // the API won't ever take it: stop trying
    await expect(s.flush(send)).resolves.toEqual({ sent: 0, waiting: 0 });
    expect(await readdir(dir)).toEqual([]);
  });

  it('skips stray files and drops a kept log that no longer parses', async () => {
    const { dir, spool: s } = await spool();
    await writeFile(join(dir, 'notes.txt'), 'x');
    await writeFile(join(dir, `${A}.json`), '{"outcome":"shrug"}');
    const send = vi.fn(() => Promise.resolve<PostResult>('posted'));
    await expect(s.flush(send)).resolves.toEqual({ sent: 0, waiting: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual(['notes.txt']);
  });

  it('has nothing to send when nothing was ever kept', async () => {
    const s = new LogSpool(join(tmpdir(), 'never-made-spool'), silentLogger);
    await expect(s.flush(() => Promise.resolve('posted'))).resolves.toEqual({
      sent: 0,
      waiting: 0,
    });
  });
});
