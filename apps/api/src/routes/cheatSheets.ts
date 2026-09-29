import {
  CheatSheetDetail,
  CheatSheetListResponse,
  CreateCheatSheetRequest,
  CreateCheatSheetResponse,
} from '@ccc/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import {
  cheatSheetDetail,
  deleteCheatSheet,
  insertCheatSheet,
  listCheatSheets,
} from '../cheatSheets/store.ts';
import {
  type CheatSheetWriter,
  CheatSheetWriterError,
  NO_CHEAT_SHEET_WRITER_MESSAGE,
} from '../cheatSheets/writer.ts';

const SheetParams = z.object({ id: z.uuid() });

export function registerCheatSheetRoutes(
  app: FastifyInstance,
  { db }: AppContext,
  /** Null without ANTHROPIC_API_KEY. */
  writer: CheatSheetWriter | null,
): void {
  app.get('/api/cheat-sheets', async () =>
    CheatSheetListResponse.parse({ sheets: await listCheatSheets(db) }),
  );

  // Written while the rep waits, in one Claude request, then kept.
  app.post('/api/cheat-sheets', async (request, reply) => {
    const parsed = CreateCheatSheetRequest.safeParse(request.body ?? {});
    if (!parsed.success) {
      const [issue] = parsed.error.issues;
      return reply.code(400).send({ error: issue?.message ?? 'Invalid request' });
    }
    if (!writer) return reply.code(503).send({ error: NO_CHEAT_SHEET_WRITER_MESSAGE });
    const { brief } = parsed.data;
    let written;
    try {
      written = await writer(brief);
    } catch (error) {
      if (!(error instanceof CheatSheetWriterError)) throw error;
      request.log.warn({ err: error }, 'writing a cheat sheet failed');
      return reply.code(502).send({ error: error.message });
    }
    const id = await insertCheatSheet(db, { ...written, brief });
    request.log.info({ cheatSheetId: id, costUsd: written.costUsd }, 'cheat sheet written');
    return reply.code(201).send(CreateCheatSheetResponse.parse({ id }));
  });

  app.get('/api/cheat-sheets/:id', async (request, reply) => {
    const { id } = SheetParams.parse(request.params);
    const sheet = await cheatSheetDetail(db, id);
    if (!sheet) return reply.code(404).send({ error: 'No such cheat sheet.' });
    return CheatSheetDetail.parse(sheet);
  });

  app.delete('/api/cheat-sheets/:id', async (request, reply) => {
    const { id } = SheetParams.parse(request.params);
    if (!(await deleteCheatSheet(db, id))) {
      return reply.code(404).send({ error: 'No such cheat sheet.' });
    }
    return reply.code(204).send();
  });
}
