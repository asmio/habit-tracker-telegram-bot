import { InlineKeyboard, type Context } from 'grammy';
import type { InlineKeyboardButton } from 'grammy/types';
import { todayDate, trackerService } from '../../services/tracker.service';
import { disabledButton } from '../ui/disabled-button';
import { HOME_CALLBACK_DATA } from '../ui/nav';
import { showScreen } from '../ui/screen';
import { toggleButtonLabel, toggleCallbackData } from '../ui/toggle-button';

/** The `callback_data` of the home screen's button that opens this screen. */
const TODAY_SCREEN = 'home:today';

/**
 * One combined keyboard for every tracker: a header row per tracker, then its item rows, then the
 * quick-nav row -- baked in here rather than at each call site, so both the initial render and
 * callback.handler.ts's post-toggle redraw get it for free.
 */
export async function buildTodayKeyboard(telegramId: number, date: string): Promise<InlineKeyboard> {
  const trackers = await trackerService.getActiveTrackers(telegramId);
  const logs = [];
  for (const tracker of trackers) {
    logs.push({ tracker, items: await trackerService.getDayLog(telegramId, tracker.id, date) });
  }

  const rows: InlineKeyboardButton[][] = [];
  for (const { tracker, items } of logs) {
    const header = items.length === 0 ? `📋 ${tracker.name} — нет пунктов` : `📋 ${tracker.name}`;
    rows.push([disabledButton(header)]);
    for (const item of items) {
      // A trailing bell + time marks an item that has a reminder set.
      const label = item.reminderTime ? `${item.label} 🔔 ${item.reminderTime}` : item.label;
      rows.push([InlineKeyboard.text(toggleButtonLabel(label, item.checked), toggleCallbackData(item.id, date))]);
    }
  }
  rows.push([InlineKeyboard.text('🏠 Домой', HOME_CALLBACK_DATA)]);

  return InlineKeyboard.from(rows);
}

/** Renders the single combined "today" screen for a user. Shared by the home screen and callback.handler.ts. */
export async function renderTodayScreen(ctx: Context, telegramId: number): Promise<void> {
  const user = await trackerService.getOrCreateUser(telegramId);
  const trackers = await trackerService.getActiveTrackers(telegramId);
  if (trackers.length === 0) {
    await showScreen(
      ctx,
      telegramId,
      TODAY_SCREEN,
      'У тебя пока нет трекеров.',
      InlineKeyboard.from([[InlineKeyboard.text('🏠 Домой', HOME_CALLBACK_DATA)]]),
    );
    return;
  }

  // The date is baked into every button, so an old screen keeps toggling its own day.
  const date = todayDate(user.timezone);
  await showScreen(ctx, telegramId, TODAY_SCREEN, `📅 ${date}`, await buildTodayKeyboard(telegramId, date));
}
