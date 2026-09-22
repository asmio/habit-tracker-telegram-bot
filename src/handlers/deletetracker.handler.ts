import { Bot, InlineKeyboard, type Context } from 'grammy';
import { logger } from '../logger';
import { NotFoundError } from '../services/errors';
import { trackerService } from '../services/tracker.service';
import type { Tracker } from '../db/schema';
import { isMessageNotModified } from './telegram-errors';
import { pickSingleOrPromptTracker } from './tracker-picker';

function confirmKeyboard(trackerId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('🗑 Да, удалить', `deletetracker-confirm:${trackerId}`)
    .text('Отмена', 'deletetracker-cancel');
}

async function promptConfirm(ctx: Context, tracker: Tracker): Promise<void> {
  await ctx.reply(
    `Удалить трекер «${tracker.name}» вместе со всеми пунктами и историей отметок? Это нельзя отменить.`,
    { reply_markup: confirmKeyboard(tracker.id) },
  );
}

export function registerDeleteTrackerHandler(bot: Bot): void {
  bot.command('deletetracker', async (ctx) => {
    if (!ctx.from) return;

    const user = await trackerService.getOrCreateUser(ctx.from.id);
    const tracker = await pickSingleOrPromptTracker(ctx, user.telegramId, 'deletetracker', 'Какой трекер удалить?');
    if (tracker) await promptConfirm(ctx, tracker);
  });

  bot.callbackQuery(/^deletetracker:(\d+)$/, async (ctx) => {
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
    await promptConfirm(ctx, tracker);
  });

  bot.callbackQuery(/^deletetracker-confirm:(\d+)$/, async (ctx) => {
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
    await ctx.editMessageText(`Трекер «${tracker.name}» удалён.`, { reply_markup: { inline_keyboard: [] } });
  });

  bot.callbackQuery('deletetracker-cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageText('Отменено.', { reply_markup: { inline_keyboard: [] } });
    } catch (error) {
      if (!isMessageNotModified(error)) throw error;
    }
  });
}
