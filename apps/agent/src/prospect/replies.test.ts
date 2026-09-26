import { describe, expect, it } from 'vitest';
import { ReplyLedger } from './replies.ts';

describe('ReplyLedger', () => {
  it('hands back the reply behind a committed message, once', () => {
    const ledger = new ReplyLedger();
    const reply = ledger.start(false);
    reply.actions = [{ type: 'end_call', reason: 'Busy' }];
    expect(ledger.committed(reply.id)).toBe(reply);
    expect(ledger.committed(reply.id)).toBeUndefined();
  });

  it('forgets replies generated before the committed one (discarded early generations)', () => {
    const ledger = new ReplyLedger();
    const discarded = ledger.start(false);
    const spoken = ledger.start(true);
    const next = ledger.start(false);
    expect(ledger.committed(spoken.id)?.forcedGoodbye).toBe(true);
    expect(ledger.committed(discarded.id)).toBeUndefined();
    expect(ledger.committed(next.id)).toBe(next);
  });

  it('ignores messages it never tagged, like the opening line', () => {
    const ledger = new ReplyLedger();
    expect(ledger.committed(undefined)).toBeUndefined();
    expect(ledger.committed('not-a-reply')).toBeUndefined();
  });

  it('keeps a bounded number of uncommitted replies', () => {
    const ledger = new ReplyLedger();
    const first = ledger.start(false);
    for (let i = 0; i < 40; i++) ledger.start(false);
    expect(ledger.committed(first.id)).toBeUndefined();
  });
});
