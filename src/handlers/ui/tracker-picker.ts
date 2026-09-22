import { InlineKeyboard, type Context } from 'grammy';
import type { Tracker, TrackerItem } from '../../db/schema';
import { trackerService } from '../../services/tracker.service';
import { editMessageTextSafely } from './telegram-errors';

export const NO_TRACKERS_TEXT = 'Сначала создай трекер командой /new.';
const BACK_LABEL = '← Назад';

type Button = ReturnType<typeof InlineKeyboard.text>;

export function backButton(callbackData: string): Button {
  return InlineKeyboard.text(BACK_LABEL, callbackData);
}

export function trackerPickerKeyboard(
  trackerList: Tracker[],
  prefix: string,
  backCallbackData?: string,
): InlineKeyboard {
  const rows: Button[][] = trackerList.map((tracker) => [InlineKeyboard.text(tracker.name, `${prefix}:${tracker.id}`)]);
  if (backCallbackData) rows.push([backButton(backCallbackData)]);
  return InlineKeyboard.from(rows);
}

export function itemPickerKeyboard(items: TrackerItem[], prefix: string, backCallbackData?: string): InlineKeyboard {
  const rows: Button[][] = items.map((item) => [InlineKeyboard.text(item.label, `${prefix}:${item.id}`)]);
  if (backCallbackData) rows.push([backButton(backCallbackData)]);
  return InlineKeyboard.from(rows);
}

export function confirmKeyboard(confirmLabel: string, confirmCallbackData: string, backCallbackData?: string): InlineKeyboard {
  const row: Button[] = [InlineKeyboard.text(confirmLabel, confirmCallbackData)];
  if (backCallbackData) row.push(backButton(backCallbackData));
  return InlineKeyboard.from([row]);
}

/** True once there is more than one tracker, i.e. whenever a "← Назад" to the tracker list is meaningful. */
export async function hasMultipleTrackers(telegramId: number): Promise<boolean> {
  return (await trackerService.getTrackers(telegramId)).length > 1;
}

/**
 * /additem, /edititem, /deleteitem and /deletetracker all start by picking a tracker, skipping
 * the picker when there is only one. Returns `undefined` once it has replied with why there is
 * nothing to pick (no trackers) or with the picker itself (more than one) -- the picker is the
 * flow's first message, so it is always sent with `ctx.reply`, never edited into an older one.
 */
export async function pickSingleOrPromptTracker(
  ctx: Context,
  telegramId: number,
  pickerPrefix: string,
  promptText: string,
): Promise<Tracker | undefined> {
  const trackerList = await trackerService.getTrackers(telegramId);
  if (trackerList.length === 0) {
    await ctx.reply(NO_TRACKERS_TEXT);
    return undefined;
  }
  if (trackerList.length === 1) {
    return trackerList[0];
  }

  await ctx.reply(promptText, { reply_markup: trackerPickerKeyboard(trackerList, pickerPrefix) });
  return undefined;
}

/** Re-renders the tracker list in place, for a "← Назад" from a screen the picker led to. */
export async function editToTrackerList(
  ctx: Context,
  telegramId: number,
  promptText: string,
  pickerPrefix: string,
): Promise<void> {
  const trackerList = await trackerService.getTrackers(telegramId);
  if (trackerList.length === 0) {
    await editMessageTextSafely(ctx, NO_TRACKERS_TEXT, { reply_markup: { inline_keyboard: [] } });
    return;
  }
  await editMessageTextSafely(ctx, promptText, { reply_markup: trackerPickerKeyboard(trackerList, pickerPrefix) });
}
