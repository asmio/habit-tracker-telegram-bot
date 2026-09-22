import { Bot, InlineKeyboard, type Context } from 'grammy';
import { logger } from '../logger';
import { NotFoundError } from '../services/errors';
import { trackerService } from '../services/tracker.service';
import type { Tracker, TrackerItem } from '../db/schema';
import { isMessageNotModified } from './telegram-errors';
import { itemPickerKeyboard, pickSingleOrPromptTracker } from './tracker-picker';

async function promptItemPicker(ctx: Context, tracker: Tracker): Promise<void> {
  const items = await trackerService.getItems(tracker.telegramId, tracker.id);
  if (items.length === 0) {
    await ctx.reply(`В трекере «${tracker.name}» нет пунктов.`);
    return;
  }
  await ctx.reply(`Какой пункт трекера «${tracker.name}» удалить?`, {
    reply_markup: itemPickerKeyboard(items, 'deleteitem-item'),
  });
}

function confirmKeyboard(itemId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('🗑 Да, удалить', `deleteitem-confirm:${itemId}`)
    .text('Отмена', 'deleteitem-cancel');
}

export function registerDeleteItemHandler(bot: Bot): void {
  bot.command('deleteitem', async (ctx) => {
    if (!ctx.from) return;

    const user = await trackerService.getOrCreateUser(ctx.from.id);
    const tracker = await pickSingleOrPromptTracker(
      ctx,
      user.telegramId,
      'deleteitem',
      'Из какого трекера удалить пункт?',
    );
    if (tracker) await promptItemPicker(ctx, tracker);
  });

  bot.callbackQuery(/^deleteitem:(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);

    let tracker: Tracker;
    try {
      tracker = await trackerService.getTracker(ctx.from.id, trackerId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Delete-item request for a tracker the user does not own', { telegramId: ctx.from.id, trackerId });
      await ctx.answerCallbackQuery({ text: 'Трекер не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    await promptItemPicker(ctx, tracker);
  });

  bot.callbackQuery(/^deleteitem-item:(\d+)$/, async (ctx) => {
    const itemId = Number(ctx.match[1]);

    let item: TrackerItem;
    try {
      item = await trackerService.getItem(ctx.from.id, itemId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Delete-item request for an item the user does not own', { telegramId: ctx.from.id, itemId });
      await ctx.answerCallbackQuery({ text: 'Пункт не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.reply(`Удалить пункт «${item.label}» и всю его историю отметок?`, {
      reply_markup: confirmKeyboard(item.id),
    });
  });

  bot.callbackQuery(/^deleteitem-confirm:(\d+)$/, async (ctx) => {
    const itemId = Number(ctx.match[1]);

    let item: TrackerItem;
    try {
      item = await trackerService.deleteItem(ctx.from.id, itemId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Delete-item confirm for an item the user does not own', { telegramId: ctx.from.id, itemId });
      await ctx.answerCallbackQuery({ text: 'Пункт не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`Пункт «${item.label}» удалён.`, { reply_markup: { inline_keyboard: [] } });
  });

  bot.callbackQuery('deleteitem-cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageText('Отменено.', { reply_markup: { inline_keyboard: [] } });
    } catch (error) {
      if (!isMessageNotModified(error)) throw error;
    }
  });
}
