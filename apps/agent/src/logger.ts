import type { log } from '@livekit/agents';

/** The framework's pino logger, typed without depending on pino directly. */
export type Logger = ReturnType<typeof log>;
