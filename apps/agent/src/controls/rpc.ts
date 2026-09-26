// Registers the rep's controls as RPC methods on the agent's participant
// (PLAN.md §9). Only the rep may call them. Every answer is validated against
// its contract before it leaves; a refusal or failure goes back as an RpcError
// whose message the web shows as it is.
import { REP_IDENTITY, type RpcMethod, RpcMethods } from '@ccc/contracts';
import { RpcError, type RpcInvocationData } from '@livekit/rtc-node';
import type { z } from 'zod';
import { type CallControls, ControlError, type ControlLogger } from './controls.ts';

export interface RpcHost {
  registerRpcMethod(method: string, handler: (data: RpcInvocationData) => Promise<string>): void;
}

const fail = (message: string) => new RpcError(RpcError.ErrorCode.APPLICATION_ERROR, message);

export function registerControls(
  host: RpcHost,
  controls: CallControls,
  logger: ControlLogger,
): void {
  const register = <S extends z.ZodType>(
    rpc: RpcMethod<S>,
    run: () => z.input<S> | Promise<z.input<S>>,
  ) => {
    host.registerRpcMethod(rpc.name, async (data) => {
      if (data.callerIdentity !== REP_IDENTITY) {
        logger.warn({ method: rpc.name, caller: data.callerIdentity }, 'control from a stranger');
        throw fail('Only the rep can control this call.');
      }
      try {
        return JSON.stringify(rpc.response.parse(await run()));
      } catch (error) {
        if (error instanceof ControlError) throw fail(error.message);
        logger.warn({ err: error, method: rpc.name }, 'control failed');
        throw fail('The agent could not do that. Try again.');
      }
    });
  };

  register(RpcMethods.pause, () => controls.pause());
  register(RpcMethods.resume, () => controls.resume());
  register(RpcMethods.hint, () => controls.hint());
  register(RpcMethods.rewind, () => controls.rewind());
  register(RpcMethods.hangup, () => controls.hangup());
}
