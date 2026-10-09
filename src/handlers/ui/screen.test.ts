import { Bot } from 'grammy';
import { sessionService } from '../../services/session.service';
import { FAKE_BOT_INFO, callbackUpdate, recordApiCalls, resetDb, setupTestDb, textUpdate } from '../../testing/harness';
import { EMPTY_KEYBOARD, showScreen } from './screen';

const UID = 1;

beforeAll(setupTestDb);
beforeEach(resetDb);

/** A throwaway bot whose only job is to call `showScreen` with whatever this test wants to check. */
function testBot() {
  const bot = new Bot('test-token', { botInfo: FAKE_BOT_INFO });
  // A callback query always has a tapped message to edit.
  bot.callbackQuery(/^test:(.+)$/, async (ctx) => {
    await showScreen(ctx, ctx.from.id, `test:${ctx.match[1]}`, `screen:${ctx.match[1]}`, EMPTY_KEYBOARD);
  });
  // A text message never has a tapped message -- showScreen must fall back to the session, if any.
  bot.on('message:text', async (ctx) => {
    await showScreen(ctx, ctx.from.id, 'test:fromtext', ctx.msg.text, EMPTY_KEYBOARD);
  });
  const calls = recordApiCalls(bot);
  return { bot, calls };
}

test('EMPTY_KEYBOARD is an explicit empty inline keyboard', () => {
  expect(EMPTY_KEYBOARD).toEqual({ inline_keyboard: [] });
});

test('with no tapped message and no session, it sends a fresh message and saves the new session', async () => {
  const { bot, calls } = testBot();
  await bot.handleUpdate(textUpdate(UID, 'hello'));

  expect(calls.map((c) => c.method)).toEqual(['sendMessage']);
  expect(calls[0].payload.text).toBe('hello');

  const session = await sessionService.getSession(UID);
  expect(session).toMatchObject({ screen: 'test:fromtext' });
});

test('a tapped message is edited in place, even when a different session exists', async () => {
  await sessionService.saveSession(UID, 777, 'some:other:screen');

  const { bot, calls } = testBot();
  await bot.handleUpdate(callbackUpdate(UID, 'test:tapped', { messageId: 42 }));

  expect(calls.map((c) => c.method)).toContain('editMessageText');
  const edit = calls.find((c) => c.method === 'editMessageText')!;
  expect(edit.payload.message_id).toBe(42);
  expect(edit.payload.text).toBe('screen:tapped');

  const session = await sessionService.getSession(UID);
  expect(session).toMatchObject({ messageId: 42, screen: 'test:tapped' });
});

test('with no tapped message but an existing session, it edits the session\'s message', async () => {
  await sessionService.saveSession(UID, 555, 'test:fromtext');

  const { bot, calls } = testBot();
  await bot.handleUpdate(textUpdate(UID, 'reply to the tracked screen'));

  const edit = calls.find((c) => c.method === 'editMessageText');
  expect(edit?.payload.message_id).toBe(555);
  expect(calls.some((c) => c.method === 'sendMessage')).toBe(false);
});

/**
 * `recordApiCalls`'s transformer is a terminal interceptor -- it never calls `prev`, so it can't be
 * composed with a second transformer underneath it (whichever is registered last wins outright).
 * These two tests need their own single transformer that both records and fakes the edit failure.
 */
function testBotWithEditFailure(description: string) {
  const bot = new Bot('test-token', { botInfo: FAKE_BOT_INFO });
  bot.on('message:text', async (ctx) => {
    await showScreen(ctx, ctx.from.id, 'test:fromtext', ctx.msg.text, EMPTY_KEYBOARD);
  });

  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === 'editMessageText') {
      return { ok: false, error_code: 400, description, parameters: {} } as never;
    }
    return { ok: true, result: { message_id: 999, date: 0, chat: { id: UID, type: 'private' } } } as never;
  });

  return { bot, calls };
}

test('"message is not modified" is not a failure: the session is still saved, with no fallback send', async () => {
  await sessionService.saveSession(UID, 555, 'test:fromtext');

  const { bot, calls } = testBotWithEditFailure('Bad Request: message is not modified');
  await bot.handleUpdate(textUpdate(UID, 'reply to the tracked screen'));
  expect(calls.map((c) => c.method)).toEqual(['editMessageText']);

  const session = await sessionService.getSession(UID);
  expect(session).toMatchObject({ messageId: 555, screen: 'test:fromtext' });
});

test('any other edit failure falls back to a fresh send, and the session moves to the new message', async () => {
  await sessionService.saveSession(UID, 555, 'test:fromtext');

  const { bot, calls } = testBotWithEditFailure('Bad Request: message to edit not found');
  await bot.handleUpdate(textUpdate(UID, 'the old message is gone'));
  expect(calls.map((c) => c.method)).toEqual(['editMessageText', 'sendMessage']);

  const session = await sessionService.getSession(UID);
  expect(session?.messageId).not.toBe(555);
  expect(session).toMatchObject({ screen: 'test:fromtext' });
});
