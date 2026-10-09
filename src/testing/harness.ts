import { Bot, type Transformer } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db';
import { registerHandlers } from '../handlers';

/**
 * Every app table, leaf-first so a plain per-table DELETE never needs `ON DELETE CASCADE` to fire --
 * relying on cascade here would hit the exact same "PRAGMA foreign_keys is a no-op mid-transaction"
 * trap that bit the real migrations (see scheduler/reminders.ts's history). Update this list whenever
 * a table is added to src/db/schema.ts.
 */
const TABLES_LEAF_FIRST = ['reminders', 'daily_logs', 'tracker_items', 'trackers', 'user_sessions', 'users'];

/**
 * Runs once per test file (each Jest test file gets its own module registry, so `db` -- and the
 * `:memory:` SQLite file behind it, see jest.setup.js -- is fresh here too): applies every migration
 * so the schema matches what production would have.
 */
export function setupTestDb(): void {
  migrate(db, { migrationsFolder: './drizzle' });
}

/**
 * Clears every table between test cases within the same file, so each `test()` starts from an empty
 * database without needing a fresh `:memory:` connection (and without relying on cascade deletes).
 * Also resets `sqlite_sequence` so autoincrement ids restart at 1 -- tests read better when the id
 * they just created is always e.g. `1`, not whatever the previous test case left behind.
 */
export function resetDb(): void {
  const sqlite = db.$client;
  for (const table of TABLES_LEAF_FIRST) {
    sqlite.exec(`DELETE FROM ${table}`);
  }
  sqlite.exec(`DELETE FROM sqlite_sequence`);
}

/** The shape `bot.api.config.use`'s transformer sees for every outgoing Bot API call. */
export interface RecordedCall {
  method: string;
  payload: Record<string, unknown>;
}

/**
 * The grammY-recommended way to unit test a bot (see grammy.dev's "Unit Testing" guide): supply
 * `botInfo` so the bot never calls the real `getMe`, then install an API transformer that intercepts
 * every outgoing call instead of hitting Telegram. `calls` accumulates everything the bot attempted
 * to send, in order, for assertions; `sendMessage` gets a fake-but-plausible response so code that
 * reads the result (e.g. to learn the new message's id) doesn't break.
 *
 * This transformer is terminal -- it never calls `prev` -- so it cannot be composed with a second
 * `bot.api.config.use(...)` registered after it to fake a specific call's failure; whichever
 * transformer is registered last always wins outright. A test that needs to inject a failure (e.g.
 * "message to edit not found") should skip this helper and write its own single transformer that
 * both records calls and returns the fake response, as `screen.test.ts` does.
 */
type ApiResult = Awaited<ReturnType<Transformer>>;

export function recordApiCalls(bot: Bot): RecordedCall[] {
  const calls: RecordedCall[] = [];
  let nextMessageId = 1000;

  const transformer: Transformer = async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });

    if (method === 'sendMessage' || method === 'sendLocation') {
      const chatId = (payload as { chat_id?: number | string }).chat_id;
      const result = { message_id: nextMessageId++, date: 0, chat: { id: chatId, type: 'private' } };
      return { ok: true, result } as unknown as ApiResult;
    }
    return { ok: true, result: true } as unknown as ApiResult;
  };
  bot.api.config.use(transformer);

  return calls;
}

let nextUpdateId = 1;

/** A minimal fake `botInfo`, just complete enough for grammY's own checks to leave it alone. */
export const FAKE_BOT_INFO = {
  id: 1,
  is_bot: true as const,
  first_name: 'Test Bot',
  username: 'test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

/**
 * Builds the real app's bot -- same `registerHandlers` wiring as `createBot` (see src/bot/index.ts)
 * -- but deliberately without its `sequentialize` (irrelevant for updates awaited one at a time) or
 * its `bot.catch` (which would swallow a handler bug into a log line instead of failing the test).
 */
export function createAppBot(): { bot: Bot; calls: RecordedCall[] } {
  const bot = new Bot('test-token', { botInfo: FAKE_BOT_INFO });
  registerHandlers(bot);
  const calls = recordApiCalls(bot);
  return { bot, calls };
}

/** Feeds a synthetic `callback_query` update into the bot's middleware, as if a button were tapped. */
export function callbackUpdate(
  telegramId: number,
  data: string,
  options: { messageId?: number; replyMarkup?: InlineKeyboardMarkup } = {},
): Parameters<Bot['handleUpdate']>[0] {
  const { messageId = 1, replyMarkup } = options;
  return {
    update_id: nextUpdateId++,
    callback_query: {
      id: String(nextUpdateId),
      from: { id: telegramId, is_bot: false, first_name: 'Test User' },
      chat_instance: 'test-chat-instance',
      data,
      message: {
        message_id: messageId,
        date: 0,
        chat: { id: telegramId, type: 'private' },
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      },
    },
  } as Parameters<Bot['handleUpdate']>[0];
}

/** Feeds a synthetic text message update, as if the user typed and sent `text`. */
export function textUpdate(telegramId: number, text: string): Parameters<Bot['handleUpdate']>[0] {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      date: 0,
      chat: { id: telegramId, type: 'private' },
      from: { id: telegramId, is_bot: false, first_name: 'Test User' },
      text,
    },
  } as Parameters<Bot['handleUpdate']>[0];
}

/** Feeds a synthetic `/command` message update, with the `bot_command` entity grammY's filters look for. */
export function commandUpdate(telegramId: number, text: string): Parameters<Bot['handleUpdate']>[0] {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      date: 0,
      chat: { id: telegramId, type: 'private' },
      from: { id: telegramId, is_bot: false, first_name: 'Test User' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
    },
  } as Parameters<Bot['handleUpdate']>[0];
}

/** Feeds a synthetic location message update, as if the user shared their geolocation. */
export function locationUpdate(telegramId: number, latitude: number, longitude: number): Parameters<Bot['handleUpdate']>[0] {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      date: 0,
      chat: { id: telegramId, type: 'private' },
      from: { id: telegramId, is_bot: false, first_name: 'Test User' },
      location: { latitude, longitude },
    },
  } as Parameters<Bot['handleUpdate']>[0];
}
