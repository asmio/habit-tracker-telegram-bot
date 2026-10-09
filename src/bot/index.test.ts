import { logger } from '../logger';
import { FAKE_BOT_INFO, commandUpdate, recordApiCalls, resetDb, setupTestDb } from '../testing/harness';
import { createBot } from './index';

const UID = 1;

beforeAll(setupTestDb);
beforeEach(resetDb);

/** `createBot` never calls the real `getMe`, so tests supply `botInfo` directly, same as the harness does. */
function initializedBot(token = 'test-token') {
  const bot = createBot(token);
  (bot as unknown as { botInfo: typeof FAKE_BOT_INFO }).botInfo = FAKE_BOT_INFO;
  return bot;
}

test('wires up the real handlers -- /start produces a response', async () => {
  const bot = initializedBot();
  const calls = recordApiCalls(bot);

  await bot.handleUpdate(commandUpdate(UID, '/start'));
  expect(calls.length).toBeGreaterThan(0);
});

test('bot.catch is wired to log an unhandled middleware error', async () => {
  // grammY only ever routes a middleware failure through the registered `bot.catch` handler from
  // its own `start()` polling loop -- a direct `handleUpdate()` call (as in every other test here)
  // always rejects instead, regardless of `.catch()`. So this calls the registered `errorHandler`
  // the same way that loop would, to check what `createBot` wires it to do.
  const bot = initializedBot();
  recordApiCalls(bot);
  const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

  bot.use(() => {
    throw new Error('boom');
  });

  const update = {
    update_id: 42,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: UID, type: 'private' },
      from: { id: UID, is_bot: false, first_name: 'Test User' },
      text: 'just chatting, matches no handler',
    },
  } as never;
  const botError = await bot.handleUpdate(update).catch((error) => error);

  bot.errorHandler(botError);
  // `bot.catch(({ error, ctx }) => ...)` destructures BotError's own `.error`, the original throw,
  // not the BotError wrapper itself.
  expect(errorSpy).toHaveBeenCalledWith('Unhandled error while processing update', {
    updateId: 42,
    error: botError.error,
  });
  errorSpy.mockRestore();
});
