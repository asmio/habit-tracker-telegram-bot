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

/** Clears every pending free-text input for one user. See `registerPendingInputReset` and `showScreen`. */
export function clearPendingInput(telegramId: number): void {
  for (const clear of clearers) clear(telegramId);
}

/**
 * Clears every pending free-text input for a user as soon as they start any command or press any
 * button, so an abandoned rename/add-item prompt (including ones started from a button rather than
 * a command) can never swallow a later, unrelated message. Register this before the handlers that
 * call `createPendingInput`, so a clear always runs before that same update might set a fresh entry.
 *
 * `ui/screen.ts`'s `showScreen` also calls `clearPendingInput` directly -- this middleware stays as
 * belt-and-suspenders for command/callback branches that never touch a screen at all (e.g. an
 * "item not found" toast that only calls `answerCallbackQuery` and returns).
 */
export function registerPendingInputReset(bot: Bot): void {
  bot.on(['::bot_command', 'callback_query'], (ctx, next) => {
    if (ctx.from) clearPendingInput(ctx.from.id);
    return next();
  });
}
