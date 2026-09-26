import { REP_IDENTITY, RpcMethods } from '@ccc/contracts';
import { RpcError, type RpcInvocationData } from '@livekit/rtc-node';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../test/fixtures.ts';
import { type CallControls, ControlError } from './controls.ts';
import { type RpcHost, registerControls } from './rpc.ts';

type Handler = (data: RpcInvocationData) => Promise<string>;

function registered(controls: Partial<CallControls>) {
  const handlers = new Map<string, Handler>();
  const host: RpcHost = { registerRpcMethod: (method, handler) => handlers.set(method, handler) };
  registerControls(host, controls as CallControls, silentLogger);
  const call = (method: string, callerIdentity = REP_IDENTITY) =>
    handlers.get(method)!({
      requestId: 'r1',
      method,
      callerIdentity,
      payload: '',
      responseTimeout: 10_000,
    });
  return { handlers, call };
}

describe('registerControls', () => {
  it('registers every control method in the contract', () => {
    const { handlers } = registered({});
    expect([...handlers.keys()]).toEqual(Object.values(RpcMethods).map((m) => m.name));
  });

  it('answers the rep with the JSON its contract describes', async () => {
    const { call } = registered({
      pause: () => ({ ok: true }),
      hint: () => Promise.resolve({ suggestions: ['One?', 'Two?', 'Three?'] }),
      rewind: () => Promise.resolve({ ok: false, reason: 'Nothing to take back.' }),
    });
    expect(JSON.parse(await call('call.pause'))).toEqual({ ok: true });
    expect(JSON.parse(await call('call.hint'))).toEqual({
      suggestions: ['One?', 'Two?', 'Three?'],
    });
    expect(JSON.parse(await call('call.rewind'))).toEqual({
      ok: false,
      reason: 'Nothing to take back.',
    });
  });

  it('refuses anyone but the rep', async () => {
    const pause = vi.fn(() => ({ ok: true }));
    const { call } = registered({ pause });
    await expect(call('call.pause', 'someone-else')).rejects.toBeInstanceOf(RpcError);
    await expect(call('call.pause', 'someone-else')).rejects.toThrow(
      'Only the rep can control this call.',
    );
    expect(pause).not.toHaveBeenCalled();
  });

  it('sends a control’s own failure back as it is, and hides anything else', async () => {
    const { call } = registered({
      hint: () => Promise.reject(new ControlError('Hint is off in exam mode.')),
      rewind: () => Promise.reject(new Error('internal detail')),
      pause: () => ({ ok: 'yes' }) as never, // breaks its contract
    });
    const refused = await call('call.hint').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(RpcError);
    expect(refused).toMatchObject({
      code: RpcError.ErrorCode.APPLICATION_ERROR,
      message: 'Hint is off in exam mode.',
    });
    await expect(call('call.rewind')).rejects.toThrow('The agent could not do that. Try again.');
    await expect(call('call.pause')).rejects.toThrow('The agent could not do that. Try again.');
  });
});
