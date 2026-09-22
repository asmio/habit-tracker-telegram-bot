import { Bot, type Context } from 'grammy';
import { logger } from '../logger';
import { NotFoundError } from '../services/errors';
import { trackerService } from '../services/tracker.service';
import type { Tracker, TrackerItem } from '../db/schema';
import { createPendingInput } from './pending-input';
import { editMessageTextSafely } from './telegram-errors';
import { editToTrackerList, hasMultipleTrackers, itemPickerKeyboard, pickSingleOrPromptTracker } from './tracker-picker';

const MAX_LABEL_LENGTH = 64;
const NO_KEYBOARD = { inline_keyboard: [] };
const TRACKER_PROMPT = 'Пункт какого трекера переименовать?';

interface PendingEditItem {
  itemId: number;
  currentLabel: string;
  chatId: number;
  messageId: number;
}

const pending = createPendingInput<PendingEditItem>();

function askText(currentLabel: string): string {
  return `Введи новое название для «${currentLabel}»:`;
}

async function itemsScreen(telegramId: number, tracker: Tracker, showBack: boolean) {
  const items = await trackerService.getItems(telegramId, tracker.id);
  const text =
    items.length === 0
      ? `В трекере «${tracker.name}» нет пунктов. Добавь их: /additem.`
      : `Какой пункт трекера «${tracker.name}» переименовать?`;
  return {
    text,
    reply_markup: itemPickerKeyboard(items, 'edititem:name', showBack ? 'edititem:trackers' : undefined),
  };
}

/** Picks a tracker (or prompts to) and shows its items. Shared by /edititem and the menu. */
export async function startEditItemFlow(ctx: Context): Promise<void> {
  if (!ctx.from) return;

  const user = await trackerService.getOrCreateUser(ctx.from.id);
  const tracker = await pickSingleOrPromptTracker(ctx, user.telegramId, 'edititem:tracker', TRACKER_PROMPT);
  if (!tracker) return;

  const screen = await itemsScreen(user.telegramId, tracker, false);
  await ctx.reply(screen.text, { reply_markup: screen.reply_markup });
}

export function registerEditItemHandler(bot: Bot): void {
  bot.command('edititem', startEditItemFlow);

  bot.callbackQuery(/^edititem:tracker:(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);

    let tracker: Tracker;
    try {
      tracker = await trackerService.getTracker(ctx.from.id, trackerId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Edit-item request for a tracker the user does not own', { telegramId: ctx.from.id, trackerId });
      await ctx.answerCallbackQuery({ text: 'Трекер не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    const screen = await itemsScreen(ctx.from.id, tracker, await hasMultipleTrackers(ctx.from.id));
    await editMessageTextSafely(ctx, screen.text, { reply_markup: screen.reply_markup });
  });

  bot.callbackQuery('edititem:trackers', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editToTrackerList(ctx, ctx.from.id, TRACKER_PROMPT, 'edititem:tracker');
  });

  bot.callbackQuery(/^edititem:name:(\d+)$/, async (ctx) => {
    const itemId = Number(ctx.match[1]);

    let item: TrackerItem;
    try {
      item = await trackerService.getItem(ctx.from.id, itemId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Edit-item request for an item the user does not own', { telegramId: ctx.from.id, itemId });
      await ctx.answerCallbackQuery({ text: 'Пункт не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    const message = ctx.callbackQuery.message;
    if (!message) {
      await ctx.reply('Сообщение устарело. Открой /edititem заново.');
      return;
    }

    await editMessageTextSafely(ctx, askText(item.label), { reply_markup: NO_KEYBOARD });
    pending.set(ctx.from.id, {
      itemId: item.id,
      currentLabel: item.label,
      chatId: message.chat.id,
      messageId: message.message_id,
    });
  });

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from) return next();
    const state = pending.consume(ctx.from.id);
    if (!state) return next();

    const label = ctx.msg.text.trim();
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
      const reason =
        label.length === 0
          ? 'Название не может быть пустым.'
          : `Слишком длинное название (максимум ${MAX_LABEL_LENGTH} символов).`;
      pending.set(ctx.from.id, state); // keep waiting: let the user retry on the same message
      await ctx.api.editMessageText(state.chatId, state.messageId, `⚠️ ${reason}\n\n${askText(state.currentLabel)}`, {
        reply_markup: NO_KEYBOARD,
      });
      return;
    }

    try {
      const item = await trackerService.updateItemLabel(ctx.from.id, state.itemId, label);
      await ctx.api.editMessageText(state.chatId, state.messageId, `✅ Пункт переименован: «${item.label}».`, {
        reply_markup: NO_KEYBOARD,
      });
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      await ctx.api.editMessageText(
        state.chatId,
        state.messageId,
        'Пункт не найден. Отправь /edititem и попробуй заново.',
        { reply_markup: NO_KEYBOARD },
      );
    }
  });
}
