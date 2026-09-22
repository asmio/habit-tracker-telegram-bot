import { InlineKeyboard, type Context } from 'grammy';
import type { Tracker, TrackerItem } from '../db/schema';
import { trackerService } from '../services/tracker.service';

export function trackerPickerKeyboard(trackerList: Tracker[], prefix: string): InlineKeyboard {
  return InlineKeyboard.from(
    trackerList.map((tracker) => [InlineKeyboard.text(tracker.name, `${prefix}:${tracker.id}`)]),
  );
}

export function itemPickerKeyboard(items: TrackerItem[], prefix: string): InlineKeyboard {
  return InlineKeyboard.from(items.map((item) => [InlineKeyboard.text(item.label, `${prefix}:${item.id}`)]));
}

/**
 * /additem, /edititem, /deleteitem, /deletetracker and /reorder all start by picking a tracker,
 * skipping the picker when there is only one. Returns `undefined` once it has replied with why
 * there is nothing to pick (no trackers) or with the picker itself (more than one).
 */
export async function pickSingleOrPromptTracker(
  ctx: Context,
  telegramId: number,
  pickerPrefix: string,
  promptText: string,
): Promise<Tracker | undefined> {
  const trackerList = await trackerService.getTrackers(telegramId);
  if (trackerList.length === 0) {
    await ctx.reply('Сначала создай трекер командой /new.');
    return undefined;
  }
  if (trackerList.length === 1) {
    return trackerList[0];
  }

  await ctx.reply(promptText, { reply_markup: trackerPickerKeyboard(trackerList, pickerPrefix) });
  return undefined;
}
