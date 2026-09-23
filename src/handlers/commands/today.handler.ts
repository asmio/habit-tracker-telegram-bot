import { Bot, InlineKeyboard, type Context } from 'grammy';
import { todayDate, trackerService } from '../../services/tracker.service';
import { HOME_CALLBACK_DATA } from '../ui/nav';
import { showScreen } from '../ui/screen';
import { toggleButtonText, toggleCallbackData } from '../ui/toggle-button';

/** The middle "📋 Tracker name" row per tracker is a read-only header, not a control. */
const HEADER_CALLBACK_DATA = 'today-header';

/**
 * One combined keyboard for every tracker: a header row per tracker, then its item rows, then the
 * quick-nav row -- baked in here rather than at each call site, so both the initial render and
 * callback.handler.ts's post-toggle redraw get it for free.
 */
export async function buildTodayKeyboard(telegramId: number, date: string): Promise<InlineKeyboard> {
  const trackers = await trackerService.getTrackers(telegramId);
  const rows: ReturnType<typeof InlineKeyboard.text>[][] = [];

  for (const tracker of trackers) {
    const items = await trackerService.getDayLog(telegramId, tracker.id, date);
    const header = items.length === 0 ? `── 📋 ${tracker.name} — нет пунктов ──` : `── 📋 ${tracker.name} ──`;
    rows.push([InlineKeyboard.text(header, HEADER_CALLBACK_DATA)]);
    for (const item of items) {
      rows.push([InlineKeyboard.text(toggleButtonText(item.label, item.checked), toggleCallbackData(item.id, date))]);
    }
  }
  rows.push([InlineKeyboard.text('🏠 Домой', HOME_CALLBACK_DATA)]);

  return InlineKeyboard.from(rows);
}

/** Renders the single combined "today" screen for a user. Shared by /today and the menu. */
export async function renderTodayScreen(ctx: Context, telegramId: number): Promise<void> {
  const user = await trackerService.getOrCreateUser(telegramId);
  const trackers = await trackerService.getTrackers(telegramId);
  if (trackers.length === 0) {
    await showScreen(
      ctx,
      telegramId,
      'У тебя пока нет трекеров. Создай первый командой /new.',
      InlineKeyboard.from([[InlineKeyboard.text('🏠 Домой', HOME_CALLBACK_DATA)]]),
    );
    return;
  }

  // The date is baked into every button, so an old screen keeps toggling its own day.
  const date = todayDate(user.timezone);
  await showScreen(ctx, telegramId, `📅 ${date}`, await buildTodayKeyboard(telegramId, date));
}

export function registerTodayHandler(bot: Bot): void {
  bot.command('today', async (ctx) => {
    if (!ctx.from) return;
    await renderTodayScreen(ctx, ctx.from.id);
  });

  bot.callbackQuery(HEADER_CALLBACK_DATA, async (ctx) => {
    await ctx.answerCallbackQuery();
  });
}
