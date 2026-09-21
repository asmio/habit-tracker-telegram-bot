import { Bot } from 'grammy';
import { todayDate, trackerService } from '../services/tracker.service';
import { trackerKeyboard } from './toggle-button';

export function registerTodayHandler(bot: Bot): void {
  bot.command('today', async (ctx) => {
    if (!ctx.from) return;

    const user = await trackerService.getOrCreateUser(ctx.from.id);
    const trackers = await trackerService.getTrackers(user.telegramId);
    if (trackers.length === 0) {
      await ctx.reply('У тебя пока нет трекеров. Создай первый командой /new.');
      return;
    }

    // The date is baked into every button, so an old message keeps toggling its own day.
    const date = todayDate(user.timezone);

    for (const tracker of trackers) {
      const items = await trackerService.getTodayLog(tracker.id);
      if (items.length === 0) {
        await ctx.reply(`📋 ${tracker.name}\n\nПунктов пока нет. Добавь их командой /additem.`);
        continue;
      }

      await ctx.reply(`📋 ${tracker.name}\n📅 ${date}`, { reply_markup: trackerKeyboard(items, date) });
    }
  });
}
