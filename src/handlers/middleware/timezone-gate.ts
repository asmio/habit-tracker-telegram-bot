import { Bot, type Context } from 'grammy';
import { trackerService } from '../../services/tracker.service';
import { promptTimezone } from '../commands/timezone.handler';

const NOT_CONFIRMED_HINT =
  'Сначала выбери часовой пояс — от него зависит, когда для тебя начинается новый день. Потом повтори действие.';

/**
 * True once the user has confirmed a time zone. Otherwise prompts them to pick one (answering a
 * callback query first, to stop the button's spinner) and returns false, so the caller can bail
 * out without running the gated action. Shared by the gate below and by the main-menu keyboard's
 * `bot.hears` handlers, which the gate itself does not cover (it only sees commands and buttons).
 */
export async function requireTimezone(ctx: Context, telegramId: number): Promise<boolean> {
  const user = await trackerService.getOrCreateUser(telegramId);
  if (user.timezoneConfirmed) return true;

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: 'Сначала выбери часовой пояс.' });
  }
  await promptTimezone(ctx, NOT_CONFIRMED_HINT);
  return false;
}

/**
 * Holds back every command and button press until the user has picked a time zone.
 * Register it after the handlers that must work without one (/start, /timezone and
 * the zone picker itself) and before everything else.
 */
export function registerTimezoneGate(bot: Bot): void {
  bot.on(['::bot_command', 'callback_query'], async (ctx, next) => {
    if (!ctx.from) return next();
    if (await requireTimezone(ctx, ctx.from.id)) return next();
  });
}
