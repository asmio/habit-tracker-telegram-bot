import { Bot } from 'grammy';
import { logger } from '../../logger';
import { NotFoundError } from '../../services/errors';
import { todayDate, trackerService } from '../../services/tracker.service';
import { showHomeScreen } from './start.handler';
import { renderTodayScreen } from './today.handler';

/**
 * The two buttons on a reminder notification (see scheduler/reminders.ts) -- a message sent
 * outside the normal screen flow, not tracked as the user's session until one of its buttons is
 * tapped. From there it behaves like any other screen: `showScreen` (inside `renderTodayScreen` /
 * `showHomeScreen`) edits whichever message was tapped, so the notification itself becomes the
 * new tracked screen, same as tapping a button on any other message does.
 */
export function registerReminderHandler(bot: Bot): void {
  bot.callbackQuery(/^reminder:check:(\d+)$/, async (ctx) => {
    const itemId = Number(ctx.match[1]);
    if (!ctx.from) return;

    try {
      // Marks it done outright rather than toggling, same as the "✅ Отметить" label promises --
      // unlike the today screen's own buttons, which do double as an undo for a stray tap.
      const user = await trackerService.getOrCreateUser(ctx.from.id);
      await trackerService.setItemChecked(ctx.from.id, itemId, todayDate(user.timezone), true);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Reminder check for an item the user does not own', { telegramId: ctx.from.id, itemId });
      await ctx.answerCallbackQuery({ text: 'Пункт не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    await renderTodayScreen(ctx, ctx.from.id);
  });

  bot.callbackQuery('reminder:home', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    await showHomeScreen(ctx, ctx.from.id);
  });
}
