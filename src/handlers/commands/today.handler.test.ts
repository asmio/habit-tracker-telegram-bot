import { todayDate, trackerService } from '../../services/tracker.service';
import { callbackUpdate, createAppBot, resetDb, setupTestDb } from '../../testing/harness';

const UID = 1;

beforeAll(setupTestDb);
beforeEach(async () => {
  resetDb();
  await trackerService.getOrCreateUser(UID);
  await trackerService.setTimezone(UID, 'UTC');
});

async function openToday() {
  const { bot, calls } = createAppBot();
  await bot.handleUpdate(callbackUpdate(UID, 'home:today', { messageId: 10 }));
  return calls.at(-1)!;
}

test('with no trackers at all, shows the empty state and only a Домой button', async () => {
  const call = await openToday();
  expect(call.payload.text).toBe('У тебя пока нет трекеров.');
  expect((call.payload.reply_markup as { inline_keyboard: unknown[] }).inline_keyboard).toEqual([
    [{ text: '🏠 Домой', callback_data: 'home' }],
  ]);
});

test('the date header reflects the user\'s own time zone', async () => {
  const tracker = await trackerService.createTracker(UID, 'Утро');
  await trackerService.createItem(UID, tracker.id, 'Зарядка');

  const call = await openToday();
  expect(call.payload.text).toMatch(/^📅 \d{4}-\d{2}-\d{2}$/);
});

test('a tracker header without items says so; with items, each becomes its own toggle row', async () => {
  const tracker = await trackerService.createTracker(UID, 'Утро');
  await trackerService.createItem(UID, tracker.id, 'Зарядка');
  const emptyTracker = await trackerService.createTracker(UID, 'Пустой');

  const call = await openToday();
  const rows = (call.payload.reply_markup as { inline_keyboard: unknown[][] }).inline_keyboard;

  expect(rows[0]).toEqual([{ text: '📋 Утро', disabled: {} }]);
  expect(rows[1]).toEqual([{ text: 'Зарядка', callback_data: expect.stringMatching(/^toggle:\d+:\d{4}-\d{2}-\d{2}$/) }]);
  expect(rows[2]).toEqual([{ text: '📋 Пустой — нет пунктов', disabled: {} }]);
});

test('an item with a reminder shows a trailing bell and time; a checked item turns green', async () => {
  const tracker = await trackerService.createTracker(UID, 'Утро');
  const item = await trackerService.createItem(UID, tracker.id, 'Зарядка');
  await trackerService.setReminderTime(UID, item.id, '09:00');

  let call = await openToday();
  let rows = (call.payload.reply_markup as { inline_keyboard: { text: string; style?: string }[][] }).inline_keyboard;
  expect(rows[1][0].text).toBe('Зарядка 🔔 09:00');
  expect(rows[1][0].style).toBeUndefined();

  await trackerService.setItemChecked(UID, item.id, todayDate('UTC'), true);
  call = await openToday();
  rows = (call.payload.reply_markup as { inline_keyboard: { text: string; style?: string }[][] }).inline_keyboard;
  expect(rows[1][0]).toMatchObject({ text: 'Зарядка 🔔 09:00', style: 'success' });
});

test('a paused tracker never appears on the today screen', async () => {
  const tracker = await trackerService.createTracker(UID, 'На паузе');
  await trackerService.createItem(UID, tracker.id, 'Пункт');
  await trackerService.setTrackerActive(UID, tracker.id, false);

  const call = await openToday();
  expect(call.payload.text).toBe('У тебя пока нет трекеров.');
});
