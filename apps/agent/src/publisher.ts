import type { Topic } from '@ccc/contracts';
import type { Room } from '@livekit/rtc-node';
import type { z } from 'zod';
import type { Logger } from './logger.ts';

/**
 * Sends topic payloads to the room with `sendText`. Payloads are validated
 * before they leave (the web validates again on receipt). A failed send is
 * logged, never thrown: publishing must not break the voice pipeline.
 */
export class Publisher {
  readonly #room: Room;
  readonly #logger: Logger;

  constructor(room: Room, logger: Logger) {
    this.#room = room;
    this.#logger = logger;
  }

  async publish<S extends z.ZodType>(topic: Topic<S>, payload: z.input<S>): Promise<void> {
    const data: unknown = topic.schema.parse(payload);
    const participant = this.#room.localParticipant;
    if (!participant) {
      this.#logger.warn({ topic: topic.name }, 'not connected; dropping message');
      return;
    }
    try {
      await participant.sendText(JSON.stringify(data), { topic: topic.name });
    } catch (error) {
      this.#logger.warn({ err: error, topic: topic.name }, 'failed to publish');
    }
  }
}
