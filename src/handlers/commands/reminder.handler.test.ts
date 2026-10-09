import { sessionService } from '../../services/session.service';
import { todayDate, trackerService } from '../../services/tracker.service';
import { callbackUpdate, createAppBot, resetDb, setupTestDb } from '../../testing/harness';

const UID = 1;
const OTHER_UID = 2;

beforeAll(setupTestDb);
beforeEach(async () => {
  resetDb();
  await trackerService.getOrCreateUser(UID);
  await trackerService.setTimezone(UID, 'UTC');
  await trackerService.getOrCreateUser(OTHER_UID);
});

test('reminder:check marks the item done for today, and turns the notification itself into the today screen', async () => {
  const tracker = await trackerService.createTracker(UID, 'Утро');
  const item = await trackerService.createItem(UID, tracker.id, 'Зарядка');
  await trackerService.setReminderTime(UID, item.id, '09:00');

  const { bot, calls } = createAppBot();
  await bot.handleUpdate(callbackUpdate(UID, `reminder:check:${item.id}`, { messageId: 500 }));

  expect(await trackerService.isItemChecked(item.id, todayDate('UTC'))).toBe(true);

  const edit = calls.find((c) => c.method === 'editMessageText')!;
  expect(edit.payload.message_id).toBe(500); // the notification message itself, not a new one
  expect(edit.payload.text).toMatch(/^📅/);

  expect(await sessionService.getSession(UID)).toMatchObject({ messageId: 500, screen: 'home:today' });
});

test('reminder:check for someone else\'s item is rejected without crashing or touching their data', async () => {
  const otherTracker = await trackerService.createTracker(OTHER_UID, 'Чужой');
  const otherItem = await trackerService.createItem(OTHER_UID, otherTracker.id, 'Чужой пункт');

  const { bot, calls } = createAppBot();
  await bot.handleUpdate(callbackUpdate(UID, `reminder:check:${otherItem.id}`, { messageId: 500 }));

  expect(calls).toEqual([
    { method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Пункт не найден.' }) },
  ]);
  expect(await trackerService.isItemChecked(otherItem.id, todayDate('UTC'))).toBe(false);
});

test('reminder:home turns the notification into the home screen', async () => {
  const { bot, calls } = createAppBot();
  await bot.handleUpdate(callbackUpdate(UID, 'reminder:home', { messageId: 500 }));

  const edit = calls.find((c) => c.method === 'editMessageText')!;
  expect(edit.payload.message_id).toBe(500);
  expect(edit.payload.text).toMatch(/Привет!/);
  expect(await sessionService.getSession(UID)).toMatchObject({ messageId: 500, screen: 'home' });
});
