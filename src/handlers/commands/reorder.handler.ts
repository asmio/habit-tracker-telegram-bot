import { Bot, InlineKeyboard, type Context } from 'grammy';
import { logger } from '../../logger';
import { NotFoundError } from '../../services/errors';
import { trackerService } from '../../services/tracker.service';
import type { Tracker, TrackerItem } from '../../db/schema';
import { isMessageNotModified } from '../ui/telegram-errors';
import { pickSingleOrPromptTracker } from '../ui/tracker-picker';

const LABEL_CALLBACK_DATA = 'reorder-label';
const DONE_CALLBACK_DATA = 'reorder-done';
/**
 * Matches `reorder:{trackerId}:{itemId}:{direction}`. The tracker id is only for the message's
 * own bookkeeping: ownership is always re-checked against the item itself, never trusted from here.
 */
const REORDER_CALLBACK_PATTERN = /^reorder:(\d+):(\d+):(up|down)$/;

function reorderKeyboard(trackerId: number, items: TrackerItem[]): InlineKeyboard {
  const rows = items.map((item, index) => [
    InlineKeyboard.text('⬆️', `reorder:${trackerId}:${item.id}:up`),
    InlineKeyboard.text(`${index + 1}. ${item.label}`, LABEL_CALLBACK_DATA),
    InlineKeyboard.text('⬇️', `reorder:${trackerId}:${item.id}:down`),
  ]);
  rows.push([InlineKeyboard.text('✅ Готово', DONE_CALLBACK_DATA)]);
  return InlineKeyboard.from(rows);
}

async function sendReorderKeyboard(ctx: Context, telegramId: number, tracker: Tracker): Promise<void> {
  const items = await trackerService.getItems(telegramId, tracker.id);
  if (items.length === 0) {
    await ctx.reply(`В трекере «${tracker.name}» нет пунктов. Добавь их: /additem.`);
    return;
  }
  await ctx.reply(`🔀 Сортировка «${tracker.name}»\nНажимай ⬆️/⬇️, чтобы поменять порядок.`, {
    reply_markup: reorderKeyboard(tracker.id, items),
  });
}

/** Picks a tracker (or prompts to) and shows the reorder keyboard. Shared by /reorder and the menu. */
export async function startReorderFlow(ctx: Context): Promise<void> {
  if (!ctx.from) return;

  const user = await trackerService.getOrCreateUser(ctx.from.id);
  const tracker = await pickSingleOrPromptTracker(
    ctx,
    user.telegramId,
    'reorder-pick',
    'Пункты какого трекера отсортировать?',
  );
  if (tracker) await sendReorderKeyboard(ctx, user.telegramId, tracker);
}

export function registerReorderHandler(bot: Bot): void {
  bot.command('reorder', startReorderFlow);

  bot.callbackQuery(/^reorder-pick:(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);

    let tracker: Tracker;
    try {
      tracker = await trackerService.getTracker(ctx.from.id, trackerId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Reorder request for a tracker the user does not own', { telegramId: ctx.from.id, trackerId });
      await ctx.answerCallbackQuery({ text: 'Трекер не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    await sendReorderKeyboard(ctx, ctx.from.id, tracker);
  });

  bot.callbackQuery(REORDER_CALLBACK_PATTERN, async (ctx) => {
    const [, , itemIdText, direction] = ctx.match;
    const itemId = Number(itemIdText);

    let trackerId: number;
    try {
      ({ trackerId } = await trackerService.moveItem(ctx.from.id, itemId, direction as 'up' | 'down'));
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Reorder for an item the user does not own', { telegramId: ctx.from.id, itemId });
      await ctx.answerCallbackQuery({ text: 'Пункт не найден.' });
      return;
    }
    await ctx.answerCallbackQuery();

    // Redraw the whole keyboard from the database: a no-op move (already at the edge) needs no
    // update, and every other tap needs the swapped positions and renumbered labels reflected.
    const items = await trackerService.getItems(ctx.from.id, trackerId);
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: reorderKeyboard(trackerId, items) });
    } catch (error) {
      if (!isMessageNotModified(error)) throw error;
    }
  });

  // The middle "N. Label" button is a read-only position marker, not a control.
  bot.callbackQuery(LABEL_CALLBACK_DATA, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(DONE_CALLBACK_DATA, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    } catch (error) {
      if (!isMessageNotModified(error)) throw error;
    }
  });
}
