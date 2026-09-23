import type { Context } from 'grammy';
import { clearPendingInput } from '../middleware/pending-input';
import { isMessageNotModified } from './telegram-errors';

export interface ScreenRef {
  chatId: number;
  messageId: number;
}

// `@grammyjs/types` isn't a direct dependency (only transitive, via grammy), so the type is
// derived from grammy's own `Context` the same way `telegram-errors.ts` already does, rather
// than importing it directly.
type EditMessageTextOptions = NonNullable<Parameters<Context['editMessageText']>[1]>;
type InlineKeyboardMarkup = NonNullable<EditMessageTextOptions['reply_markup']>;

/**
 * Explicit "no buttons" for `showScreen`/`rememberScreen`. `editMessageText`'s `reply_markup` is
 * optional at the Bot API level, but *omitting* it leaves the message's existing keyboard alone —
 * it does not clear it. Every caller must pass a keyboard on purpose, this one when it means none.
 */
export const EMPTY_KEYBOARD: InlineKeyboardMarkup = { inline_keyboard: [] };

/** The one message per user that the bot currently treats as "the screen" — see `showScreen`. */
const screens = new Map<number, ScreenRef>();

/**
 * Renders a top-level screen for a user: edits their previously tracked message in place if one
 * exists and the edit succeeds, otherwise sends a fresh message and starts tracking that instead.
 * This is what makes the bot feel like a single screen instead of a growing chat log — every
 * command, every persistent-keyboard button and every management-menu button should call this
 * (or `rememberScreen`) rather than `ctx.reply` directly.
 *
 * Always clears any pending free-text input first (see `clearPendingInput`): showing a *different*
 * screen means whatever the user was previously asked to type no longer has anywhere to go.
 */
export async function showScreen(
  ctx: Context,
  telegramId: number,
  text: string,
  replyMarkup: InlineKeyboardMarkup,
): Promise<ScreenRef> {
  clearPendingInput(telegramId);

  const tracked = screens.get(telegramId);
  if (tracked) {
    try {
      await ctx.api.editMessageText(tracked.chatId, tracked.messageId, text, { reply_markup: replyMarkup });
      return tracked;
    } catch (error) {
      if (isMessageNotModified(error)) return tracked;
      // Message deleted, chat gone, or anything else that makes editing impossible: fall through
      // to a fresh send below. A genuinely broken chat (e.g. the bot was blocked) will fail there
      // too, and that failure is left to propagate to `bot.catch`.
    }
  }

  const sent = await ctx.reply(text, { reply_markup: replyMarkup });
  const ref: ScreenRef = { chatId: sent.chat.id, messageId: sent.message_id };
  screens.set(telegramId, ref);
  return ref;
}

/**
 * Records a message the caller already sent itself as the new "current screen". For the rare
 * cases that must send a fresh message on purpose — a `ReplyKeyboardMarkup` (the persistent main
 * menu, `force_reply`, a location request) can only ever be attached by sending, never by editing.
 */
export function rememberScreen(telegramId: number, chatId: number, messageId: number): ScreenRef {
  clearPendingInput(telegramId);
  const ref: ScreenRef = { chatId, messageId };
  screens.set(telegramId, ref);
  return ref;
}
