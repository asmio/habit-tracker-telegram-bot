import { Bot } from 'grammy';
import { trackerService } from '../services/tracker.service';
import { promptTimezone } from './timezone.handler';

/**
 * Holds back every command and button press until the user has picked a time zone.
 * Register it after the handlers that must work without one (/start, /timezone and
 * the zone picker itself) and before everything else.
 */
export function registerTimezoneGate(bot: Bot): void {
  bot.on(['::bot_command', 'callback_query'], async (ctx, next) => {
    if (!ctx.from) return next();

    const user = await trackerService.getOrCreateUser(ctx.from.id);
    if (user.timezoneConfirmed) return next();

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: 'Сначала выбери часовой пояс.' });
    }
    await promptTimezone(
      ctx,
      'Сначала выбери часовой пояс — от него зависит, когда для тебя начинается новый день. Потом повтори команду.',
    );
  });
}
