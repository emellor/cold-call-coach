// Call logs the API couldn't take (it was down or unreachable when the call
// ended) wait on disk here, and go out at the start of the next call, so a
// call's log arrives even when the API restarts during it.
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CallLog } from '@ccc/contracts';
import type { PostResult } from './post.ts';

export const DEFAULT_SPOOL_DIR = join(tmpdir(), 'cold-call-coach', 'unsent-logs');

const FILE = /^([0-9a-f-]{36})\.json$/;

export interface SpoolLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export class LogSpool {
  readonly #dir: string;
  readonly #logger: SpoolLogger;

  constructor(dir: string, logger: SpoolLogger) {
    this.#dir = dir;
    this.#logger = logger;
  }

  /** Keeps a log to send later; written whole, so a crash never leaves half a file. */
  async save(callId: string, log: CallLog): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    const file = join(this.#dir, `${callId}.json`);
    await writeFile(`${file}.part`, JSON.stringify(log));
    await rename(`${file}.part`, file);
    this.#logger.warn({ callId, dir: this.#dir }, 'kept the call log to send later');
  }

  /**
   * Sends every kept log. Posted or refused, a log leaves the spool (refused
   * means a retry won't help); unreachable, it waits for the next flush.
   */
  async flush(
    send: (callId: string, log: CallLog) => Promise<PostResult>,
  ): Promise<{ sent: number; waiting: number }> {
    let names: string[];
    try {
      names = await readdir(this.#dir);
    } catch {
      return { sent: 0, waiting: 0 }; // nothing was ever kept
    }
    let sent = 0;
    let waiting = 0;
    for (const name of names) {
      const callId = FILE.exec(name)?.[1];
      if (!callId) continue;
      const file = join(this.#dir, name);
      const parsed = CallLog.safeParse(
        await readFile(file, 'utf8').then(
          (text) => JSON.parse(text) as unknown,
          () => null,
        ),
      );
      if (!parsed.success) {
        this.#logger.warn({ callId }, 'dropped a kept call log that no longer parses');
        await rm(file, { force: true });
        continue;
      }
      const result = await send(callId, parsed.data);
      if (result === 'unreachable') {
        waiting += 1;
        continue;
      }
      await rm(file, { force: true });
      if (result === 'posted') sent += 1;
    }
    if (sent || waiting) this.#logger.info({ sent, waiting }, 'flushed kept call logs');
    return { sent, waiting };
  }
}
