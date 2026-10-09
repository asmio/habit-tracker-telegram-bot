import type { InlineKeyboardMarkup } from 'grammy/types';
import { trackerService } from '../../services/tracker.service';
import { toggleCallbackData } from '../ui/toggle-button';
import { callbackUpdate, createAppBot, resetDb, setupTestDb } from '../../testing/harness';

const UID = 1;
const OTHER_UID = 2;
const DATE = '2026-01-01';

beforeAll(setupTestDb);
beforeEach(async () => {
  resetDb();
  await trackerService.getOrCreateUser(UID);
  await trackerService.setTimezone(UID, 'UTC'); // past the timezone gate
  await trackerService.getOrCreateUser(OTHER_UID);
});

async function fixtureItem(telegramId = UID) {
  const tracker = await trackerService.createTracker(telegramId, 'Утро');
  return trackerService.createItem(telegramId, tracker.id, 'Зарядка');
}

/** A minimal but realistic reply_markup containing exactly one toggle button, as the real screen would. */
function markupWithToggle(data: string, text: string, checked = false): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [checked ? { text, style: 'success' as const, callback_data: data } : { text, callback_data: data }],
    ],
  };
}

test('tapping an unchecked item checks it and redraws the keyboard green', async () => {
  const item = await fixtureItem();
  const data = toggleCallbackData(item.id, DATE);

  const { bot, calls } = createAppBot();
  await bot.handleUpdate(callbackUpdate(UID, data, { messageId: 10, replyMarkup: markupWithToggle(data, 'Зарядка') }));

  expect(await trackerService.isItemChecked(item.id, DATE)).toBe(true);
  const redraw = calls.find((c) => c.method === 'editMessageReplyMarkup')!;
  const button = (redraw.payload.reply_markup as { inline_keyboard: { style?: string }[][] }).inline_keyboard
    .flat()
    .find((b) => 'callback_data' in b);
  expect(button).toMatchObject({ style: 'success' });
});

test('tapping a checked (green) item unchecks it', async () => {
  const item = await fixtureItem();
  const data = toggleCallbackData(item.id, DATE);
  await trackerService.setItemChecked(UID, item.id, DATE, true);

  const { bot } = createAppBot();
  await bot.handleUpdate(
    callbackUpdate(UID, data, { messageId: 10, replyMarkup: markupWithToggle(data, 'Зарядка', true) }),
  );

  expect(await trackerService.isItemChecked(item.id, DATE)).toBe(false);
});

test('a button no longer present on the (stale) message re-renders the current today screen instead of toggling', async () => {
  const item = await fixtureItem();
  const data = toggleCallbackData(item.id, DATE);

  const { bot, calls } = createAppBot();
  // The message's own keyboard has gone stale: it no longer contains this exact callback_data.
  await bot.handleUpdate(
    callbackUpdate(UID, data, { messageId: 10, replyMarkup: { inline_keyboard: [[{ text: 'x', callback_data: 'y' }]] } }),
  );

  expect(calls.map((c) => c.method)).toEqual(['answerCallbackQuery', 'editMessageText']);
  expect(calls[0].payload.text).toBe('Сообщение устарело, обновляю.');
  expect(await trackerService.isItemChecked(item.id, DATE)).toBe(false); // nothing was toggled
});

test('toggling an item that belongs to someone else is rejected without crashing', async () => {
  const item = await fixtureItem(OTHER_UID);
  const data = toggleCallbackData(item.id, DATE);

  const { bot, calls } = createAppBot();
  await bot.handleUpdate(callbackUpdate(UID, data, { messageId: 10, replyMarkup: markupWithToggle(data, 'Зарядка') }));

  expect(calls).toEqual([{ method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Пункт не найден.' }) }]);
});

test('an unexpected error (not a NotFoundError) still answers the callback, then propagates', async () => {
  const item = await fixtureItem();
  // Syntactically a date (matches the pattern), but not a real calendar day -- fails the DB's own
  // CHECK constraint, not the ownership check, so this exercises the generic-error branch.
  const data = toggleCallbackData(item.id, '2026-13-40');

  const { bot, calls } = createAppBot();
  await expect(
    bot.handleUpdate(callbackUpdate(UID, data, { messageId: 10, replyMarkup: markupWithToggle(data, 'Зарядка') })),
  ).rejects.toThrow();

  expect(calls).toEqual([
    { method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Не удалось обновить пункт. Попробуй ещё раз.' }) },
  ]);
});
