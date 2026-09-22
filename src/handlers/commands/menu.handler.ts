import { Bot, InlineKeyboard, type Context } from 'grammy';
import { todayDate, trackerService } from '../../services/tracker.service';
import { requireTimezone } from '../middleware/timezone-gate';
import { trackerKeyboard } from '../ui/toggle-button';
import { startAddItemFlow } from './additem.handler';
import { startDeleteItemFlow } from './deleteitem.handler';
import { startDeleteTrackerFlow } from './deletetracker.handler';
import { startEditItemFlow } from './edititem.handler';
import { startNewTrackerFlow } from './new.handler';
import { startReorderFlow } from './reorder.handler';

const MANAGEMENT_TEXT = 'Что хочешь сделать?';

function managementKeyboard(): InlineKeyboard {
  return InlineKeyboard.from([
    [InlineKeyboard.text('✏️ Переименовать пункт', 'menu:edititem')],
    [InlineKeyboard.text('🗑 Удалить пункт', 'menu:deleteitem')],
    [InlineKeyboard.text('🗑 Удалить трекер', 'menu:deletetracker')],
    [InlineKeyboard.text('🔀 Сортировка', 'menu:reorder')],
    [InlineKeyboard.text('➕ Добавить пункт', 'menu:additem')],
  ]);
}

/**
 * Same rendering as /today. today.handler.ts is off limits for this change, so this is recomposed
 * from its already-shared, exported pieces (trackerService, todayDate, trackerKeyboard) rather than
 * imported -- there is no private logic of that file being duplicated here.
 */
async function showToday(ctx: Context): Promise<void> {
  if (!ctx.from) return;

  const user = await trackerService.getOrCreateUser(ctx.from.id);
  const trackers = await trackerService.getTrackers(user.telegramId);
  if (trackers.length === 0) {
    await ctx.reply('У тебя пока нет трекеров. Создай первый командой /new.');
    return;
  }

  const date = todayDate(user.timezone);

  for (const tracker of trackers) {
    const items = await trackerService.getTodayLog(tracker.id);
    if (items.length === 0) {
      await ctx.reply(`📋 ${tracker.name}\n\nПунктов пока нет. Добавь их командой /additem.`);
      continue;
    }

    await ctx.reply(`📋 ${tracker.name}\n📅 ${date}`, { reply_markup: trackerKeyboard(items, date) });
  }
}

export function registerMenuHandler(bot: Bot): void {
  // `bot.hears` matches on message text regardless of the timezone gate (which only sees commands
  // and callback queries), so each alias re-checks it itself before doing anything.
  bot.hears('📋 Сегодня', async (ctx) => {
    if (!ctx.from || !(await requireTimezone(ctx, ctx.from.id))) return;
    await showToday(ctx);
  });

  bot.hears('➕ Новый трекер', async (ctx) => {
    if (!ctx.from || !(await requireTimezone(ctx, ctx.from.id))) return;
    await startNewTrackerFlow(ctx);
  });

  bot.hears('✏️ Управление', async (ctx) => {
    if (!ctx.from || !(await requireTimezone(ctx, ctx.from.id))) return;
    await ctx.reply(MANAGEMENT_TEXT, { reply_markup: managementKeyboard() });
  });

  // Each button starts the same flow as its /command, via the function that command itself calls.
  bot.callbackQuery('menu:edititem', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startEditItemFlow(ctx);
  });

  bot.callbackQuery('menu:deleteitem', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startDeleteItemFlow(ctx);
  });

  bot.callbackQuery('menu:deletetracker', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startDeleteTrackerFlow(ctx);
  });

  bot.callbackQuery('menu:reorder', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startReorderFlow(ctx);
  });

  bot.callbackQuery('menu:additem', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startAddItemFlow(ctx);
  });
}
