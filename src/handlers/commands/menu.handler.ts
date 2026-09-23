import { Bot } from 'grammy';
import { requireTimezone } from '../middleware/timezone-gate';
import { HOME_CALLBACK_DATA, SETTINGS_CALLBACK_DATA } from '../ui/nav';
import { startNewTrackerFlow } from './new.handler';
import { showSettingsScreen } from './settings.handler';
import { showHomeScreen } from './start.handler';
import { startTimezoneFlow } from './timezone.handler';
import { renderTodayScreen } from './today.handler';
import { showTrackersListScreen } from './trackers.handler';

export function registerMenuHandler(bot: Bot): void {
  // `bot.hears` matches on message text regardless of the timezone gate (which only sees commands
  // and callback queries), so each alias re-checks it itself before doing anything.
  bot.hears('📋 Сегодня', async (ctx) => {
    if (!ctx.from || !(await requireTimezone(ctx, ctx.from.id))) return;
    await renderTodayScreen(ctx, ctx.from.id);
  });

  bot.hears('➕ Новый трекер', async (ctx) => {
    if (!ctx.from || !(await requireTimezone(ctx, ctx.from.id))) return;
    await startNewTrackerFlow(ctx);
  });

  // The home screen's 3 buttons (see start.handler.ts) and the settings screen they lead to (see
  // settings.handler.ts). Wired here, not in those files, to avoid a circular import between them
  // (settings needs the home screen for "← Назад"; the home screen needs settings for its button).
  // HOME_CALLBACK_DATA is the shared "← Назад" target for any screen that leads back to home.
  bot.callbackQuery(HOME_CALLBACK_DATA, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    await showHomeScreen(ctx, ctx.from.id);
  });

  bot.callbackQuery('home:today', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    await renderTodayScreen(ctx, ctx.from.id);
  });

  bot.callbackQuery('home:trackers', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    await showTrackersListScreen(ctx, ctx.from.id);
  });

  // The trackers list's own "➕ Новый трекер" row (see trackers.handler.ts). Wired here rather than
  // there, to avoid a circular import: trackers.handler.ts would need new.handler.ts for this, and
  // new.handler.ts needs trackers.handler.ts's `showTrackersListScreen` for its own success screen.
  bot.callbackQuery('trackers:new', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startNewTrackerFlow(ctx, 'trackers:list');
  });

  bot.callbackQuery(SETTINGS_CALLBACK_DATA, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    await showSettingsScreen(ctx, ctx.from.id);
  });

  bot.callbackQuery('settings:timezone', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startTimezoneFlow(ctx);
  });
}
