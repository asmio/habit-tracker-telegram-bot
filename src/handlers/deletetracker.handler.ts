import { Bot, type Context } from 'grammy';
import { logger } from '../logger';
import { NotFoundError } from '../services/errors';
import { trackerService } from '../services/tracker.service';
import type { Tracker } from '../db/schema';
import { editMessageTextSafely } from './telegram-errors';
import { confirmKeyboard, editToTrackerList, hasMultipleTrackers, pickSingleOrPromptTracker } from './tracker-picker';

const TRACKER_PROMPT = 'Какой трекер удалить?';

function confirmScreen(tracker: Tracker, showBack: boolean) {
  return {
    text: `Удалить «${tracker.name}» вместе со всеми пунктами и историей?`,
    reply_markup: confirmKeyboard(
      '🗑 Да, удалить',
      `deletetracker:done:${tracker.id}`,
      showBack ? 'deletetracker:trackers' : undefined,
    ),
  };
}

/** Picks a tracker (or prompts to) and shows the confirm screen. Shared by /deletetracker and the menu. */
export async function startDeleteTrackerFlow(ctx: Context): Promise<void> {
  if (!ctx.from) return;

  const user = await trackerService.getOrCreateUser(ctx.from.id);
  const tracker = await pickSingleOrPromptTracker(ctx, user.telegramId, 'deletetracker:confirm', TRACKER_PROMPT);
  if (!tracker) return;

  const screen = confirmScreen(tracker, false);
  await ctx.reply(screen.text, { reply_markup: screen.reply_markup });
}

export function registerDeleteTrackerHandler(bot: Bot): void {
  bot.command('deletetracker', startDeleteTrackerFlow);

  bot.callbackQuery(/^deletetracker:confirm:(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);

    let tracker: Tracker;
    try {
      tracker = await trackerService.getTracker(ctx.from.id, trackerId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Delete-tracker request for a tracker the user does not own', {
        telegramId: ctx.from.id,
        trackerId,
      });
      await ctx.answerCallbackQuery({ text: 'Трекер не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    const screen = confirmScreen(tracker, await hasMultipleTrackers(ctx.from.id));
    await editMessageTextSafely(ctx, screen.text, { reply_markup: screen.reply_markup });
  });

  bot.callbackQuery('deletetracker:trackers', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editToTrackerList(ctx, ctx.from.id, TRACKER_PROMPT, 'deletetracker:confirm');
  });

  bot.callbackQuery(/^deletetracker:done:(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);

    let tracker: Tracker;
    try {
      tracker = await trackerService.deleteTracker(ctx.from.id, trackerId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Delete-tracker confirm for a tracker the user does not own', {
        telegramId: ctx.from.id,
        trackerId,
      });
      await ctx.answerCallbackQuery({ text: 'Трекер не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`✅ Трекер «${tracker.name}» удалён.`, { reply_markup: { inline_keyboard: [] } });
  });
}
