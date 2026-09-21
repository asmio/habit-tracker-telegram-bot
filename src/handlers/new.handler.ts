import { Bot } from 'grammy';
import { trackerService } from '../services/tracker.service';
import { getBotPromptText } from './prompt';

const NAME_PROMPT = 'Как назвать новый трекер? Ответь на это сообщение.';
const MAX_NAME_LENGTH = 64;

export function registerNewHandler(bot: Bot): void {
  bot.command('new', async (ctx) => {
    await ctx.reply(NAME_PROMPT, {
      reply_markup: { force_reply: true, input_field_placeholder: 'Название трекера' },
    });
  });

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from || getBotPromptText(ctx) !== NAME_PROMPT) return next();

    const name = ctx.msg.text.trim();
    if (name.length > MAX_NAME_LENGTH) {
      await ctx.reply(`Слишком длинное название (максимум ${MAX_NAME_LENGTH} символов). Отправь /new и попробуй ещё раз.`);
      return;
    }

    const user = await trackerService.getOrCreateUser(ctx.from.id);
    const tracker = await trackerService.createTracker(user.telegramId, name);
    await ctx.reply(`Трекер «${tracker.name}» создан ✅ Добавь пункты: /additem`);
  });
}
