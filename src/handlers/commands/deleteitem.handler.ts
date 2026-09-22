import { Bot, type Context } from 'grammy';
import { logger } from '../../logger';
import { NotFoundError } from '../../services/errors';
import { trackerService } from '../../services/tracker.service';
import type { Tracker, TrackerItem } from '../../db/schema';
import { editMessageTextSafely } from '../ui/telegram-errors';
import { confirmKeyboard, editToTrackerList, hasMultipleTrackers, itemPickerKeyboard, pickSingleOrPromptTracker } from '../ui/tracker-picker';

const TRACKER_PROMPT = 'Из какого трекера удалить пункт?';

async function itemsScreen(telegramId: number, tracker: Tracker, showBack: boolean) {
  const items = await trackerService.getItems(telegramId, tracker.id);
  const text =
    items.length === 0
      ? `В трекере «${tracker.name}» нет пунктов.`
      : `Какой пункт трекера «${tracker.name}» удалить?`;
  return {
    text,
    reply_markup: itemPickerKeyboard(
      items,
      `deleteitem:confirm:${tracker.id}`,
      showBack ? 'deleteitem:trackers' : undefined,
    ),
  };
}

function confirmScreen(item: TrackerItem, trackerId: number) {
  return {
    text: `Удалить «${item.label}»?`,
    reply_markup: confirmKeyboard('🗑 Да', `deleteitem:done:${item.id}`, `deleteitem:items:${trackerId}`),
  };
}

/** Picks a tracker (or prompts to) and shows its items. Shared by /deleteitem and the menu. */
export async function startDeleteItemFlow(ctx: Context): Promise<void> {
  if (!ctx.from) return;

  const user = await trackerService.getOrCreateUser(ctx.from.id);
  const tracker = await pickSingleOrPromptTracker(ctx, user.telegramId, 'deleteitem:tracker', TRACKER_PROMPT);
  if (!tracker) return;

  const screen = await itemsScreen(user.telegramId, tracker, false);
  await ctx.reply(screen.text, { reply_markup: screen.reply_markup });
}

export function registerDeleteItemHandler(bot: Bot): void {
  bot.command('deleteitem', startDeleteItemFlow);

  bot.callbackQuery(/^deleteitem:tracker:(\d+)$/, async (ctx) => {
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
    const screen = await itemsScreen(ctx.from.id, tracker, await hasMultipleTrackers(ctx.from.id));
    await editMessageTextSafely(ctx, screen.text, { reply_markup: screen.reply_markup });
  });

  bot.callbackQuery('deleteitem:trackers', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editToTrackerList(ctx, ctx.from.id, TRACKER_PROMPT, 'deleteitem:tracker');
  });

  // "← Назад" from the confirm screen: re-render the same tracker's item list.
  bot.callbackQuery(/^deleteitem:items:(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);

    let tracker: Tracker;
    try {
      tracker = await trackerService.getTracker(ctx.from.id, trackerId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Delete-item back-to-items for a tracker the user does not own', {
        telegramId: ctx.from.id,
        trackerId,
      });
      await ctx.answerCallbackQuery({ text: 'Трекер не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    const screen = await itemsScreen(ctx.from.id, tracker, await hasMultipleTrackers(ctx.from.id));
    await editMessageTextSafely(ctx, screen.text, { reply_markup: screen.reply_markup });
  });

  bot.callbackQuery(/^deleteitem:confirm:(\d+):(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);
    const itemId = Number(ctx.match[2]);

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
    const screen = confirmScreen(item, trackerId);
    await editMessageTextSafely(ctx, screen.text, { reply_markup: screen.reply_markup });
  });

  bot.callbackQuery(/^deleteitem:done:(\d+)$/, async (ctx) => {
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
    await ctx.editMessageText(`✅ Пункт «${item.label}» удалён.`, { reply_markup: { inline_keyboard: [] } });
  });
}
