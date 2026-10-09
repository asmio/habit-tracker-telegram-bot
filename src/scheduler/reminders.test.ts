import { Bot } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';
import { trackerService } from '../services/tracker.service';
import { FAKE_BOT_INFO, recordApiCalls, resetDb, setupTestDb } from '../testing/harness';
import { runReminderTick } from './reminders';

const UID = 1;
const OTHER_UID = 2;

beforeAll(setupTestDb);
beforeEach(resetDb);

function newBot() {
  const bot = new Bot('test-token', { botInfo: FAKE_BOT_INFO });
  const calls = recordApiCalls(bot);
  return { bot, calls };
}

/** A tracker for `telegramId`, whose owner has already confirmed `timezone`. */
async function fixtureTracker(telegramId: number, timezone: string) {
  await trackerService.getOrCreateUser(telegramId);
  await trackerService.setTimezone(telegramId, timezone);
  return trackerService.createTracker(telegramId, 'Утро');
}

describe('runReminderTick', () => {
  test("sends a reminder when the item's time matches the owner's current local time", async () => {
    const tracker = await fixtureTracker(UID, 'Europe/Moscow'); // fixed UTC+3, no DST
    const item = await trackerService.createItem(UID, tracker.id, 'Зарядка');
    await trackerService.setReminderTime(UID, item.id, '09:00');

    const { bot, calls } = newBot();
    await runReminderTick(bot, new Date('2026-01-01T06:00:00.000Z')); // 09:00 Moscow

    const sent = calls.filter((c) => c.method === 'sendMessage');
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.chat_id).toBe(UID);
    expect(sent[0].payload.text).toBe('📋 Утро\n⏰ Зарядка');

    const keyboard = (sent[0].payload.reply_markup as InlineKeyboardMarkup).inline_keyboard;
    expect(keyboard[0].map((b) => 'callback_data' in b && b.callback_data)).toEqual([
      `reminder:check:${item.id}`,
      'reminder:home',
    ]);
  });

  test('does not send when the current local time does not match', async () => {
    const tracker = await fixtureTracker(UID, 'Europe/Moscow');
    const item = await trackerService.createItem(UID, tracker.id, 'Зарядка');
    await trackerService.setReminderTime(UID, item.id, '23:59');

    const { bot, calls } = newBot();
    await runReminderTick(bot, new Date('2026-01-01T06:00:00.000Z')); // 09:00 Moscow
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(0);
  });

  test('a second tick at the same minute does not send a duplicate', async () => {
    const tracker = await fixtureTracker(UID, 'Europe/Moscow');
    const item = await trackerService.createItem(UID, tracker.id, 'Зарядка');
    await trackerService.setReminderTime(UID, item.id, '09:00');

    const { bot, calls } = newBot();
    const now = new Date('2026-01-01T06:00:00.000Z');
    await runReminderTick(bot, now);
    await runReminderTick(bot, now);
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1);
  });

  test('skips an item already checked for the day, and leaves no "already sent" marker', async () => {
    const tracker = await fixtureTracker(UID, 'Europe/Moscow');
    const item = await trackerService.createItem(UID, tracker.id, 'Зарядка');
    await trackerService.setReminderTime(UID, item.id, '09:00');
    await trackerService.setItemChecked(UID, item.id, '2026-01-01', true);

    const { bot, calls } = newBot();
    await runReminderTick(bot, new Date('2026-01-01T06:00:00.000Z'));
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(0);
    expect(await trackerService.hasReminderLog(item.id, '2026-01-01')).toBe(false);
  });

  test("a paused tracker's items are never candidates, so they never get reminded", async () => {
    const tracker = await fixtureTracker(UID, 'Europe/Moscow');
    const item = await trackerService.createItem(UID, tracker.id, 'Зарядка');
    await trackerService.setReminderTime(UID, item.id, '09:00');
    await trackerService.setTrackerActive(UID, tracker.id, false);

    const { bot, calls } = newBot();
    await runReminderTick(bot, new Date('2026-01-01T06:00:00.000Z'));
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(0);
  });

  test('rescheduling to a later time the same day still fires once the new time arrives', async () => {
    const tracker = await fixtureTracker(UID, 'Europe/Moscow');
    const item = await trackerService.createItem(UID, tracker.id, 'Зарядка');
    await trackerService.setReminderTime(UID, item.id, '09:00');

    const { bot, calls } = newBot();
    await runReminderTick(bot, new Date('2026-01-01T06:00:00.000Z')); // 09:00 Moscow
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1);

    await trackerService.setReminderTime(UID, item.id, '15:00');
    await runReminderTick(bot, new Date('2026-01-01T12:00:00.000Z')); // 15:00 Moscow
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(2);
  });

  test("two users in different time zones each get reminded on their own local clock, not the other's", async () => {
    const trackerMoscow = await fixtureTracker(UID, 'Europe/Moscow'); // UTC+3
    const itemMoscow = await trackerService.createItem(UID, trackerMoscow.id, 'A');
    await trackerService.setReminderTime(UID, itemMoscow.id, '09:00');

    const trackerUtc = await fixtureTracker(OTHER_UID, 'UTC');
    const itemUtc = await trackerService.createItem(OTHER_UID, trackerUtc.id, 'B');
    await trackerService.setReminderTime(OTHER_UID, itemUtc.id, '09:00'); // same local time, different instant

    const { bot, calls } = newBot();
    await runReminderTick(bot, new Date('2026-01-01T06:00:00.000Z')); // 09:00 Moscow, 06:00 UTC
    expect(calls.filter((c) => c.method === 'sendMessage').map((c) => c.payload.chat_id)).toEqual([UID]);

    await runReminderTick(bot, new Date('2026-01-01T09:00:00.000Z')); // 09:00 UTC, 12:00 Moscow
    expect(calls.filter((c) => c.method === 'sendMessage').map((c) => c.payload.chat_id)).toEqual([UID, OTHER_UID]);
  });

  test('a failed send is not recorded as sent, and does not throw out of the tick', async () => {
    const tracker = await fixtureTracker(UID, 'Europe/Moscow');
    const item = await trackerService.createItem(UID, tracker.id, 'Зарядка');
    await trackerService.setReminderTime(UID, item.id, '09:00');

    const bot = new Bot('test-token', { botInfo: FAKE_BOT_INFO });
    bot.api.config.use(async () => {
      throw new Error('bot was blocked by the user');
    });

    await expect(runReminderTick(bot, new Date('2026-01-01T06:00:00.000Z'))).resolves.toBeUndefined();
    expect(await trackerService.hasReminderLog(item.id, '2026-01-01')).toBe(false);
  });
});
