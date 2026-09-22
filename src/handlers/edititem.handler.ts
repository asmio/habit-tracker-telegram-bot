import { Bot, type Context } from 'grammy';
import { logger } from '../logger';
import { NotFoundError } from '../services/errors';
import { trackerService } from '../services/tracker.service';
import type { Tracker, TrackerItem } from '../db/schema';
import { getBotPromptText } from './prompt';
import { itemPickerKeyboard, pickSingleOrPromptTracker } from './tracker-picker';

const PROMPT_PREFIX = 'Новое название для';
// The prompt ends with the item id, so the reply can be tied to it without any stored state.
// The id is only a hint: `updateItemLabel` re-checks that the item belongs to the sender.
const PROMPT_ITEM_ID = /\(пункт №(\d+)\)$/;
const MAX_LABEL_LENGTH = 64;

async function promptItemPicker(ctx: Context, tracker: Tracker): Promise<void> {
  const items = await trackerService.getItems(tracker.telegramId, tracker.id);
  if (items.length === 0) {
    await ctx.reply(`В трекере «${tracker.name}» нет пунктов. Добавь их: /additem.`);
    return;
  }
  await ctx.reply(`Какой пункт трекера «${tracker.name}» переименовать?`, {
    reply_markup: itemPickerKeyboard(items, 'edititem-item'),
  });
}

async function promptNewLabel(ctx: Context, item: TrackerItem): Promise<void> {
  await ctx.reply(`${PROMPT_PREFIX} «${item.label}»? Ответь на это сообщение. (пункт №${item.id})`, {
    reply_markup: { force_reply: true, input_field_placeholder: 'Новое название' },
  });
}

export function registerEditItemHandler(bot: Bot): void {
  bot.command('edititem', async (ctx) => {
    if (!ctx.from) return;

    const user = await trackerService.getOrCreateUser(ctx.from.id);
    const tracker = await pickSingleOrPromptTracker(
      ctx,
      user.telegramId,
      'edititem',
      'Пункт какого трекера переименовать?',
    );
    if (tracker) await promptItemPicker(ctx, tracker);
  });

  bot.callbackQuery(/^edititem:(\d+)$/, async (ctx) => {
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
    await promptItemPicker(ctx, tracker);
  });

  bot.callbackQuery(/^edititem-item:(\d+)$/, async (ctx) => {
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
    await promptNewLabel(ctx, item);
  });

  bot.on('message:text', async (ctx, next) => {
    const prompt = getBotPromptText(ctx);
    const itemId = prompt?.startsWith(PROMPT_PREFIX) ? PROMPT_ITEM_ID.exec(prompt)?.[1] : undefined;
    if (!ctx.from || itemId === undefined) return next();

    const label = ctx.msg.text.trim();
    if (label.length === 0) {
      await ctx.reply('Название не может быть пустым. Попробуй ещё раз.');
      return;
    }
    if (label.length > MAX_LABEL_LENGTH) {
      await ctx.reply(`Слишком длинное название (максимум ${MAX_LABEL_LENGTH} символов). Попробуй ещё раз.`);
      return;
    }

    let item: TrackerItem;
    try {
      item = await trackerService.updateItemLabel(ctx.from.id, Number(itemId), label);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      await ctx.reply('Пункт не найден. Отправь /edititem и попробуй заново.');
      return;
    }

    await ctx.reply(`Пункт переименован в «${item.label}» ✅`);
  });
}
