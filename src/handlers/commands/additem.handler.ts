import { Bot, type Context } from 'grammy';
import { logger } from '../../logger';
import { NotFoundError } from '../../services/errors';
import { trackerService } from '../../services/tracker.service';
import type { Tracker } from '../../db/schema';
import { createPendingInput } from '../middleware/pending-input';
import { editMessageTextSafely } from '../ui/telegram-errors';
import { pickSingleOrPromptTracker } from '../ui/tracker-picker';

const MAX_LABEL_LENGTH = 64;
const NO_KEYBOARD = { inline_keyboard: [] };

interface PendingAddItem {
  trackerId: number;
  trackerName: string;
  chatId: number;
  messageId: number;
}

const pending = createPendingInput<PendingAddItem>();

function askText(trackerName: string): string {
  return `Введи название нового пункта для трекера «${trackerName}»:`;
}

/** Picks a tracker (or prompts to) and arms the pending text input. Shared by /additem and the menu. */
export async function startAddItemFlow(ctx: Context): Promise<void> {
  if (!ctx.from) return;

  const user = await trackerService.getOrCreateUser(ctx.from.id);
  const tracker = await pickSingleOrPromptTracker(ctx, user.telegramId, 'additem:tracker', 'К какому трекеру добавить пункт?');
  if (!tracker) return;

  const sent = await ctx.reply(askText(tracker.name), { reply_markup: NO_KEYBOARD });
  pending.set(user.telegramId, {
    trackerId: tracker.id,
    trackerName: tracker.name,
    chatId: sent.chat.id,
    messageId: sent.message_id,
  });
}

export function registerAddItemHandler(bot: Bot): void {
  bot.command('additem', startAddItemFlow);

  bot.callbackQuery(/^additem:tracker:(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);

    let tracker: Tracker;
    try {
      tracker = await trackerService.getTracker(ctx.from.id, trackerId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Add-item request for a tracker the user does not own', { telegramId: ctx.from.id, trackerId });
      await ctx.answerCallbackQuery({ text: 'Трекер не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    const message = ctx.callbackQuery.message;
    if (!message) {
      await ctx.reply('Сообщение устарело. Открой /additem заново.');
      return;
    }

    await editMessageTextSafely(ctx, askText(tracker.name), { reply_markup: NO_KEYBOARD });
    pending.set(ctx.from.id, {
      trackerId: tracker.id,
      trackerName: tracker.name,
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
      await ctx.api.editMessageText(state.chatId, state.messageId, `⚠️ ${reason}\n\n${askText(state.trackerName)}`, {
        reply_markup: NO_KEYBOARD,
      });
      return;
    }

    try {
      const item = await trackerService.createItem(ctx.from.id, state.trackerId, label);
      await ctx.api.editMessageText(
        state.chatId,
        state.messageId,
        `✅ Пункт «${item.label}» добавлен в «${state.trackerName}».`,
        { reply_markup: NO_KEYBOARD },
      );
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      await ctx.api.editMessageText(
        state.chatId,
        state.messageId,
        'Трекер не найден. Отправь /additem и попробуй заново.',
        { reply_markup: NO_KEYBOARD },
      );
    }
  });
}
