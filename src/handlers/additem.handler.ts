import { Bot, type Context } from 'grammy';
import { logger } from '../logger';
import { NotFoundError } from '../services/errors';
import { trackerService } from '../services/tracker.service';
import type { Tracker } from '../db/schema';
import { getBotPromptText } from './prompt';
import { pickSingleOrPromptTracker } from './tracker-picker';

const PROMPT_PREFIX = 'Пришли пункты для трекера';
// The prompt ends with the tracker id, so the reply can be tied to it without any stored state.
// The id is only a hint: `createItem` re-checks that the tracker belongs to the sender.
const PROMPT_TRACKER_ID = /\(трекер №(\d+)\)$/;
const MAX_ITEMS_PER_MESSAGE = 20;
const MAX_LABEL_LENGTH = 64;

async function promptForItems(ctx: Context, tracker: Tracker): Promise<void> {
  await ctx.reply(
    `${PROMPT_PREFIX} «${tracker.name}» — по одному на строку. Ответь на это сообщение. (трекер №${tracker.id})`,
    { reply_markup: { force_reply: true, input_field_placeholder: 'Каждый пункт с новой строки' } },
  );
}

export function registerAddItemHandler(bot: Bot): void {
  bot.command('additem', async (ctx) => {
    if (!ctx.from) return;

    const user = await trackerService.getOrCreateUser(ctx.from.id);
    const tracker = await pickSingleOrPromptTracker(ctx, user.telegramId, 'additem', 'К какому трекеру добавить пункты?');
    if (tracker) await promptForItems(ctx, tracker);
  });

  bot.callbackQuery(/^additem:(\d+)$/, async (ctx) => {
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
    await promptForItems(ctx, tracker);
  });

  bot.on('message:text', async (ctx, next) => {
    const prompt = getBotPromptText(ctx);
    const trackerId = prompt?.startsWith(PROMPT_PREFIX) ? PROMPT_TRACKER_ID.exec(prompt)?.[1] : undefined;
    if (!ctx.from || trackerId === undefined) return next();

    const labels = ctx.msg.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (labels.length > MAX_ITEMS_PER_MESSAGE) {
      await ctx.reply(`Слишком много пунктов за раз (максимум ${MAX_ITEMS_PER_MESSAGE}). Отправь /additem и попробуй ещё раз.`);
      return;
    }
    if (labels.some((label) => label.length > MAX_LABEL_LENGTH)) {
      await ctx.reply(`Слишком длинный пункт (максимум ${MAX_LABEL_LENGTH} символов). Отправь /additem и попробуй ещё раз.`);
      return;
    }

    try {
      for (const label of labels) {
        await trackerService.createItem(ctx.from.id, Number(trackerId), label);
      }
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      await ctx.reply('Трекер не найден. Отправь /additem и выбери трекер заново.');
      return;
    }

    await ctx.reply(`Добавлено пунктов: ${labels.length}. Посмотреть: /today`);
  });
}
