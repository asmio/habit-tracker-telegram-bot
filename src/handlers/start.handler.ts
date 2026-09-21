import { Bot } from 'grammy';
import { trackerService } from '../services/tracker.service';
import { promptTimezone } from './timezone.handler';

export function registerStartHandler(bot: Bot): void {
  bot.command('start', async (ctx) => {
    if (!ctx.from) return;

    const user = await trackerService.getOrCreateUser(ctx.from.id);
    await ctx.reply('Привет! Я помогу отслеживать твои привычки.');

    if (!user.timezoneConfirmed) {
      await promptTimezone(ctx);
      return;
    }
    await ctx.reply('/today — сегодняшний день\n/new — новый трекер\n/additem — добавить пункты\n/timezone — часовой пояс');
  });
}
