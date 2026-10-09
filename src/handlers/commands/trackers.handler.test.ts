import { sessionService } from '../../services/session.service';
import { trackerService } from '../../services/tracker.service';
import { callbackUpdate, createAppBot, resetDb, setupTestDb, textUpdate } from '../../testing/harness';

const UID = 1;
const OTHER_UID = 2;

beforeAll(setupTestDb);
beforeEach(async () => {
  resetDb();
  await trackerService.getOrCreateUser(UID);
  await trackerService.setTimezone(UID, 'UTC'); // past the timezone gate
  await trackerService.getOrCreateUser(OTHER_UID);
});

async function fixtureTracker(telegramId = UID) {
  return trackerService.createTracker(telegramId, 'Утро');
}

async function fixtureItem(telegramId = UID) {
  const tracker = await fixtureTracker(telegramId);
  return trackerService.createItem(telegramId, tracker.id, 'Зарядка');
}

async function tap(data: string, messageId = 10) {
  const { bot, calls } = createAppBot();
  await bot.handleUpdate(callbackUpdate(UID, data, { messageId }));
  return calls;
}

describe('trackers:list', () => {
  test('shows every tracker, inactive ones marked, newest at the bottom', async () => {
    await trackerService.createTracker(UID, 'Активный');
    const paused = await trackerService.createTracker(UID, 'Пауза');
    await trackerService.setTrackerActive(UID, paused.id, false);

    const calls = await tap('trackers:list');
    const rows = (calls.at(-1)!.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard;
    expect(rows[0][0].text).toBe('Активный');
    expect(rows[1][0].text).toBe('⏸ Пауза');
  });

  test('with no trackers, shows the empty-state text', async () => {
    const calls = await tap('trackers:list');
    expect(calls.at(-1)?.payload.text).toBe('Трекеров пока нет.');
  });
});

describe('trackers:open:<id>', () => {
  test('shows the tracker with its items, add-item, and management rows', async () => {
    const item = await fixtureItem();
    const calls = await tap(`trackers:open:${item.trackerId}`);
    expect(calls.at(-1)?.payload.text).toBe('📋 Утро');
    const rows = (calls.at(-1)!.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard;
    expect(rows[0]).toEqual([{ text: 'Зарядка', callback_data: `trackers:item:${item.id}` }]);
  });

  test('a paused tracker says so in the text', async () => {
    const tracker = await fixtureTracker();
    await trackerService.setTrackerActive(UID, tracker.id, false);
    const calls = await tap(`trackers:open:${tracker.id}`);
    expect(calls.at(-1)?.payload.text).toBe('📋 Утро | Отключён\n\nПунктов пока нет.');
  });

  test('someone else\'s tracker falls back to the list with a warning', async () => {
    const theirs = await fixtureTracker(OTHER_UID);
    const calls = await tap(`trackers:open:${theirs.id}`);
    expect(calls.at(-1)?.payload.text).toMatch(/⚠️ Трекер не найден\./);
  });
});

describe('trackers:toggleactive:<id>', () => {
  test('flips isActive and re-renders the tracker screen', async () => {
    const tracker = await fixtureTracker();
    await tap(`trackers:toggleactive:${tracker.id}`);
    expect((await trackerService.getTracker(UID, tracker.id)).isActive).toBe(false);
  });

  test('is ownership-checked', async () => {
    const theirs = await fixtureTracker(OTHER_UID);
    const calls = await tap(`trackers:toggleactive:${theirs.id}`);
    expect(calls).toEqual([{ method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Трекер не найден.' }) }]);
    expect((await trackerService.getTracker(OTHER_UID, theirs.id)).isActive).toBe(true);
  });
});

describe('sort screen', () => {
  test('trackers:sort:<id> lists items as position markers, movable only down (circular)', async () => {
    const tracker = await fixtureTracker();
    const a = await trackerService.createItem(UID, tracker.id, 'A');
    await trackerService.createItem(UID, tracker.id, 'B');

    const calls = await tap(`trackers:sort:${tracker.id}`);
    const rows = (calls.at(-1)!.payload.reply_markup as { inline_keyboard: unknown[][] }).inline_keyboard;
    expect(rows[0]).toEqual([
      { text: '1. A', disabled: {} },
      { text: '⬇️', callback_data: `trackers:sortmove:${a.id}:down` },
    ]);
  });

  test('someone else\'s tracker falls back to the list', async () => {
    const theirs = await fixtureTracker(OTHER_UID);
    const calls = await tap(`trackers:sort:${theirs.id}`);
    expect(calls.at(-1)?.payload.text).toMatch(/⚠️ Трекер не найден\./);
  });

  test('sortmove reorders and redraws renumbered labels', async () => {
    const tracker = await fixtureTracker();
    const a = await trackerService.createItem(UID, tracker.id, 'A');
    const b = await trackerService.createItem(UID, tracker.id, 'B');

    const calls = await tap(`trackers:sortmove:${a.id}:down`);
    const redraw = calls.find((c) => c.method === 'editMessageReplyMarkup')!;
    const rows = (redraw.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard;
    expect(rows[0][0].text).toBe('1. B');
    expect(rows[1][0].text).toBe('2. A');

    const items = await trackerService.getItems(UID, tracker.id);
    expect(items.map((i) => i.id)).toEqual([b.id, a.id]);
  });

  test('sortmove is ownership-checked', async () => {
    const theirs = await fixtureItem(OTHER_UID);
    const calls = await tap(`trackers:sortmove:${theirs.id}:down`);
    expect(calls).toEqual([{ method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Пункт не найден.' }) }]);
  });
});

describe('trackers:item:<id>', () => {
  test('shows the item with a reminder-setup button when none is set yet', async () => {
    const item = await fixtureItem();
    const calls = await tap(`trackers:item:${item.id}`);
    expect(calls.at(-1)?.payload.text).toBe('📝 Зарядка');
    const rows = (calls.at(-1)!.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard;
    expect(rows[0]).toEqual([{ text: '🔔 Добавить напоминание', callback_data: `trackers:setreminder:${item.id}` }]);
  });

  test('once a reminder is set, shows its time plus a remove button', async () => {
    const item = await fixtureItem();
    await trackerService.setReminderTime(UID, item.id, '09:00');

    const calls = await tap(`trackers:item:${item.id}`);
    const rows = (calls.at(-1)!.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard;
    expect(rows[0]).toEqual([
      { text: '🔔 09:00 ✏️', callback_data: `trackers:setreminder:${item.id}` },
      { text: '🔕 Убрать', callback_data: `trackers:delreminder:${item.id}` },
    ]);
  });

  test('someone else\'s item falls back to the list', async () => {
    const theirs = await fixtureItem(OTHER_UID);
    const calls = await tap(`trackers:item:${theirs.id}`);
    expect(calls.at(-1)?.payload.text).toMatch(/⚠️ Пункт не найден\./);
  });
});

describe('reminders', () => {
  test('trackers:setreminder opens the ЧЧ:ММ prompt', async () => {
    const item = await fixtureItem();
    const calls = await tap(`trackers:setreminder:${item.id}`);
    expect(calls.at(-1)?.payload.text).toMatch(/ЧЧ:ММ/);
    expect(await sessionService.getSession(UID)).toMatchObject({ screen: `trackers:setreminder:${item.id}` });
  });

  test('trackers:setreminder is ownership-checked', async () => {
    const theirs = await fixtureItem(OTHER_UID);
    const calls = await tap(`trackers:setreminder:${theirs.id}`);
    expect(calls).toEqual([{ method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Пункт не найден.' }) }]);
  });

  test('a valid ЧЧ:ММ reply saves it and returns to the item screen', async () => {
    const item = await fixtureItem();
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, `trackers:setreminder:${item.id}`, { messageId: 10 }));
    await bot.handleUpdate(textUpdate(UID, '09:00'));

    expect((await trackerService.getItem(UID, item.id)).reminderTime).toBe('09:00');
    expect(calls.at(-1)?.payload.text).toBe('📝 Зарядка');
  });

  test('an invalid reply re-prompts on the same screen without saving', async () => {
    const item = await fixtureItem();
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, `trackers:setreminder:${item.id}`, { messageId: 10 }));
    await bot.handleUpdate(textUpdate(UID, '25:99'));

    expect(calls.at(-1)?.payload.text).toMatch(/Неверный формат/);
    expect((await trackerService.getItem(UID, item.id)).reminderTime).toBeNull();
    expect(await sessionService.getSession(UID)).toMatchObject({ screen: `trackers:setreminder:${item.id}` });
  });

  test('trackers:delreminder clears it and returns to the item screen', async () => {
    const item = await fixtureItem();
    await trackerService.setReminderTime(UID, item.id, '09:00');

    const calls = await tap(`trackers:delreminder:${item.id}`);
    expect((await trackerService.getItem(UID, item.id)).reminderTime).toBeNull();
    const rows = (calls.at(-1)!.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard;
    expect(rows[0]).toEqual([{ text: '🔔 Добавить напоминание', callback_data: `trackers:setreminder:${item.id}` }]);
  });

  test('trackers:delreminder is ownership-checked', async () => {
    const theirs = await fixtureItem(OTHER_UID);
    await trackerService.setReminderTime(OTHER_UID, theirs.id, '09:00');

    const calls = await tap(`trackers:delreminder:${theirs.id}`);
    expect(calls).toEqual([{ method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Пункт не найден.' }) }]);
    expect((await trackerService.getItem(OTHER_UID, theirs.id)).reminderTime).toBe('09:00');
  });
});

describe('rename / add-item prompts', () => {
  test('trackers:renametracker opens the rename prompt', async () => {
    const tracker = await fixtureTracker();
    const calls = await tap(`trackers:renametracker:${tracker.id}`);
    expect(calls.at(-1)?.payload.text).toBe('Введи новое название для «Утро»:');
  });

  test('trackers:renametracker is ownership-checked', async () => {
    const theirs = await fixtureTracker(OTHER_UID);
    const calls = await tap(`trackers:renametracker:${theirs.id}`);
    expect(calls).toEqual([{ method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Трекер не найден.' }) }]);
  });

  test('a valid new tracker name is saved, landing back on the tracker screen', async () => {
    const tracker = await fixtureTracker();
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, `trackers:renametracker:${tracker.id}`, { messageId: 10 }));
    await bot.handleUpdate(textUpdate(UID, 'Вечер'));

    expect((await trackerService.getTracker(UID, tracker.id)).name).toBe('Вечер');
    expect(calls.at(-1)?.payload.text).toBe('📋 Вечер\n\nПунктов пока нет.');
  });

  test('an empty tracker name is rejected', async () => {
    const tracker = await fixtureTracker();
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, `trackers:renametracker:${tracker.id}`, { messageId: 10 }));
    await bot.handleUpdate(textUpdate(UID, '   '));

    expect(calls.at(-1)?.payload.text).toMatch(/Название не может быть пустым/);
    expect((await trackerService.getTracker(UID, tracker.id)).name).toBe('Утро');
  });

  test('trackers:additem opens the add-item prompt', async () => {
    const tracker = await fixtureTracker();
    const calls = await tap(`trackers:additem:${tracker.id}`);
    expect(calls.at(-1)?.payload.text).toBe('Введи название нового пункта для трекера «Утро»:');
  });

  test('trackers:additem is ownership-checked', async () => {
    const theirs = await fixtureTracker(OTHER_UID);
    const calls = await tap(`trackers:additem:${theirs.id}`);
    expect(calls).toEqual([{ method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Трекер не найден.' }) }]);
  });

  test('a valid item name is appended, landing back on the tracker screen', async () => {
    const tracker = await fixtureTracker();
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, `trackers:additem:${tracker.id}`, { messageId: 10 }));
    await bot.handleUpdate(textUpdate(UID, 'Новый пункт'));

    const items = await trackerService.getItems(UID, tracker.id);
    expect(items.map((i) => i.label)).toEqual(['Новый пункт']);
    expect(calls.at(-1)?.payload.text).toBe('📋 Утро');
  });

  test('trackers:renameitem opens the rename prompt', async () => {
    const item = await fixtureItem();
    const calls = await tap(`trackers:renameitem:${item.id}`);
    expect(calls.at(-1)?.payload.text).toBe('Введи новое название для «Зарядка»:');
  });

  test('trackers:renameitem is ownership-checked', async () => {
    const theirs = await fixtureItem(OTHER_UID);
    const calls = await tap(`trackers:renameitem:${theirs.id}`);
    expect(calls).toEqual([{ method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Пункт не найден.' }) }]);
  });

  test('a valid new item label is saved, landing back on the item screen', async () => {
    const item = await fixtureItem();
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, `trackers:renameitem:${item.id}`, { messageId: 10 }));
    await bot.handleUpdate(textUpdate(UID, 'Растяжка'));

    expect((await trackerService.getItem(UID, item.id)).label).toBe('Растяжка');
    expect(calls.at(-1)?.payload.text).toBe('📝 Растяжка');
  });

  test('a name over 64 characters is rejected', async () => {
    const tracker = await fixtureTracker();
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, `trackers:renametracker:${tracker.id}`, { messageId: 10 }));
    await bot.handleUpdate(textUpdate(UID, 'x'.repeat(65)));

    expect(calls.at(-1)?.payload.text).toMatch(/Слишком длинное название/);
  });

  test('replying to a prompt whose tracker/item has since been deleted falls back to the list', async () => {
    const tracker = await fixtureTracker();
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, `trackers:renametracker:${tracker.id}`, { messageId: 10 }));
    await trackerService.deleteTracker(UID, tracker.id);

    await bot.handleUpdate(textUpdate(UID, 'Новое имя'));
    expect(calls.at(-1)?.payload.text).toMatch(/⚠️ Трекер не найден\./);
  });

  test('typing while not on any prompt screen is ignored by this handler', async () => {
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(textUpdate(UID, 'just chatting'));
    expect(calls).toHaveLength(0);
  });
});

describe('deleting a tracker', () => {
  test('trackers:deltracker shows a confirmation, without deleting yet', async () => {
    const tracker = await fixtureTracker();
    const calls = await tap(`trackers:deltracker:${tracker.id}`);
    expect(calls.at(-1)?.payload.text).toBe('Удалить «Утро» вместе со всеми пунктами и историей?');
    await expect(trackerService.getTracker(UID, tracker.id)).resolves.toBeDefined();
  });

  test('trackers:deltracker is ownership-checked', async () => {
    const theirs = await fixtureTracker(OTHER_UID);
    const calls = await tap(`trackers:deltracker:${theirs.id}`);
    expect(calls).toEqual([{ method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Трекер не найден.' }) }]);
  });

  test('trackers:deltrackerconfirm actually deletes it and confirms on the list', async () => {
    const tracker = await fixtureTracker();
    const calls = await tap(`trackers:deltrackerconfirm:${tracker.id}`);
    expect(calls.at(-1)?.payload.text).toBe('✅ Трекер «Утро» удалён.\n\nТрекеров пока нет.');
    await expect(trackerService.getTracker(UID, tracker.id)).rejects.toThrow();
  });

  test('trackers:deltrackerconfirm is ownership-checked', async () => {
    const theirs = await fixtureTracker(OTHER_UID);
    const calls = await tap(`trackers:deltrackerconfirm:${theirs.id}`);
    expect(calls).toEqual([{ method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Трекер не найден.' }) }]);
    await expect(trackerService.getTracker(OTHER_UID, theirs.id)).resolves.toBeDefined();
  });
});

describe('deleting an item', () => {
  test('trackers:delitem shows a confirmation, without deleting yet', async () => {
    const item = await fixtureItem();
    const calls = await tap(`trackers:delitem:${item.id}`);
    expect(calls.at(-1)?.payload.text).toBe('Удалить «Зарядка»?');
    await expect(trackerService.getItem(UID, item.id)).resolves.toBeDefined();
  });

  test('trackers:delitem is ownership-checked', async () => {
    const theirs = await fixtureItem(OTHER_UID);
    const calls = await tap(`trackers:delitem:${theirs.id}`);
    expect(calls).toEqual([{ method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Пункт не найден.' }) }]);
  });

  test('trackers:delitemconfirm actually deletes it and confirms on the tracker screen', async () => {
    const item = await fixtureItem();
    const calls = await tap(`trackers:delitemconfirm:${item.id}`);
    expect(calls.at(-1)?.payload.text).toMatch(/✅ Пункт «Зарядка» удалён\./);
    await expect(trackerService.getItem(UID, item.id)).rejects.toThrow();
  });

  test('trackers:delitemconfirm is ownership-checked', async () => {
    const theirs = await fixtureItem(OTHER_UID);
    const calls = await tap(`trackers:delitemconfirm:${theirs.id}`);
    expect(calls).toEqual([{ method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Пункт не найден.' }) }]);
    await expect(trackerService.getItem(OTHER_UID, theirs.id)).resolves.toBeDefined();
  });
});
