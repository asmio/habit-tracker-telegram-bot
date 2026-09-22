import type { Bot } from 'grammy';

type Clearer = (telegramId: number) => void;
const clearers: Clearer[] = [];

/**
 * A small per-user, per-flow store for a pending free-text reply (e.g. "waiting for a new
 * tracker item's name"). State lives only in this process's memory: a restart loses it, which
 * just means the user has to start the command again, never a stale or misdirected write.
 */
export function createPendingInput<T>() {
  const pending = new Map<number, T>();
  clearers.push((telegramId) => pending.delete(telegramId));

  return {
    set(telegramId: number, value: T): void {
      pending.set(telegramId, value);
    },
    /** Reads and removes the entry, if any. */
    consume(telegramId: number): T | undefined {
      const value = pending.get(telegramId);
      pending.delete(telegramId);
      return value;
    },
  };
}

/**
 * Clears every pending free-text input for a user as soon as they start any command or press any
 * button, so an abandoned /additem or /edititem (including ones started from the main menu, which
 * enters these flows via a button rather than a command) can never swallow a later, unrelated
 * message. Register this before the handlers that call `createPendingInput`, so a clear always
 * runs before that same update might set a fresh entry.
 */
export function registerPendingInputReset(bot: Bot): void {
  bot.on(['::bot_command', 'callback_query'], (ctx, next) => {
    if (ctx.from) {
      for (const clear of clearers) clear(ctx.from.id);
    }
    return next();
  });
}
