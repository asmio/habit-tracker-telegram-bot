import type { Context } from 'grammy';
import { logger } from '../../logger';
import { sessionService } from '../../services/session.service';
import { isMessageNotModified } from './telegram-errors';

interface ScreenRef {
  chatId: number;
  messageId: number;
}

// `@grammyjs/types` isn't a direct dependency (only transitive, via grammy), so the type is
// derived from grammy's own `Context` the same way `telegram-errors.ts` already does, rather
// than importing it directly.
type EditMessageTextOptions = NonNullable<Parameters<Context['editMessageText']>[1]>;
type InlineKeyboardMarkup = NonNullable<EditMessageTextOptions['reply_markup']>;

/**
 * Explicit "no buttons" for `showScreen`. `editMessageText`'s `reply_markup` is optional at the Bot
 * API level, but *omitting* it leaves the message's existing keyboard alone — it does not clear it.
 * Every caller must pass a keyboard on purpose, this one when it means none.
 */
export const EMPTY_KEYBOARD: InlineKeyboardMarkup = { inline_keyboard: [] };

/**
 * Which message should become the new screen: the one whose button was just tapped, if any (this is
 * what keeps buttons on an old message working after a restart, or after /start replaced the
 * screen -- the tap edits that very message instead of spawning a new one), else the persisted
 * session's message. The persisted `chatId` is the user's id: the bot only talks in private chats.
 */
async function resolveTarget(ctx: Context, telegramId: number): Promise<ScreenRef | undefined> {
  const tapped = ctx.callbackQuery?.message;
  if (tapped) return { chatId: tapped.chat.id, messageId: tapped.message_id };

  const session = await sessionService.getSession(telegramId);
  return session ? { chatId: telegramId, messageId: session.messageId } : undefined;
}

/**
 * Renders a top-level screen for a user: edits the target message in place if there is one and the
 * edit succeeds, otherwise sends a fresh message. Either way the message that ends up showing the
 * screen is persisted as the user's session, together with `screen` -- its route in `callback_data`
 * format (e.g. `trackers:open:5`). This is what makes the bot feel like a single screen instead of
 * a growing chat log -- every command and every button should call this rather than `ctx.reply`.
 *
 * Never pass this the ref of a message that was ever sent with a `ReplyKeyboardMarkup` (including
 * `remove_keyboard`): Telegram refuses to attach an `InlineKeyboardMarkup` to one via edit ("message
 * can't be edited"), which silently falls through to a confusing extra fresh message below. Such a
 * send should stay a one-off, disposable message instead (see timezone.handler.ts's `sendDisposable`).
 *
 * The stored `screen` is also how the bot knows it is waiting for typed text (see e.g.
 * new.handler.ts): a prompt is "active" exactly while it is the session's screen, so showing any
 * *different* screen cancels it by itself, and the wait survives a restart along with the session.
 */
export async function showScreen(
  ctx: Context,
  telegramId: number,
  screen: string,
  text: string,
  replyMarkup: InlineKeyboardMarkup,
): Promise<void> {
  const target = await resolveTarget(ctx, telegramId);
  if (target) {
    try {
      await ctx.api.editMessageText(target.chatId, target.messageId, text, { reply_markup: replyMarkup });
      await sessionService.saveSession(telegramId, target.messageId, screen);
      return;
    } catch (error) {
      if (isMessageNotModified(error)) {
        await sessionService.saveSession(telegramId, target.messageId, screen);
        return;
      }
      // "message to edit not found" (deleted, or a session pointing at a message that is gone),
      // chat gone, or anything else that makes editing impossible: fall through to a fresh send
      // below. A genuinely broken chat (e.g. the bot was blocked) will fail there too, and that
      // failure is left to propagate to `bot.catch`. Logged (not silently swallowed): a message
      // whose reply_markup was ever a ReplyKeyboardMarkup can never be edited into one with an
      // InlineKeyboardMarkup ("message can't be edited"), which previously fell through to this
      // same fresh-send path invisibly and looked like a duplicate message.
      logger.warn('showScreen: edit failed, falling back to a fresh send', {
        telegramId,
        screen,
        target,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sent = await ctx.reply(text, { reply_markup: replyMarkup });
  await sessionService.saveSession(telegramId, sent.message_id, screen);
}
