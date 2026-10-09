import { NotFoundError } from './errors';
import { isValidTimezone, todayDate, trackerService } from './tracker.service';
import { resetDb, setupTestDb } from '../testing/harness';

const UID = 1;
const OTHER_UID = 2;

beforeAll(setupTestDb);
beforeEach(async () => {
  resetDb();
  // `trackers.telegramId` has a FK to `users.telegramId`: every test gets both fixture users for
  // free, so individual tests don't each need to remember `getOrCreateUser` before `createTracker`.
  await trackerService.getOrCreateUser(UID);
  await trackerService.getOrCreateUser(OTHER_UID);
});

describe('isValidTimezone', () => {
  test('accepts a real IANA zone name', () => {
    expect(isValidTimezone('Europe/Minsk')).toBe(true);
  });

  test('rejects a UTC offset -- it looks valid to Intl but ignores DST', () => {
    expect(isValidTimezone('+03:00')).toBe(false);
  });

  test('rejects garbage', () => {
    expect(isValidTimezone('Not/A_Zone')).toBe(false);
  });
});

describe('todayDate', () => {
  test('renders YYYY-MM-DD in the given zone, not the host zone', () => {
    // 2026-01-01T23:30 UTC is already 2026-01-02 in Europe/Minsk (UTC+3).
    const now = new Date('2026-01-01T23:30:00.000Z');
    expect(todayDate('UTC', now)).toBe('2026-01-01');
    expect(todayDate('Europe/Minsk', now)).toBe('2026-01-02');
  });
});

describe('users', () => {
  test('getOrCreateUser creates a row with UTC defaults, then returns the same row on a second call', async () => {
    const created = await trackerService.getOrCreateUser(UID);
    expect(created.telegramId).toBe(UID);
    expect(created.timezone).toBe('UTC');
    expect(created.timezoneConfirmed).toBe(false);

    const again = await trackerService.getOrCreateUser(UID);
    expect(again.id).toBe(created.id);
  });

  test('setTimezone saves a valid zone and marks it confirmed', async () => {
    await trackerService.getOrCreateUser(UID);
    const user = await trackerService.setTimezone(UID, 'Europe/Minsk');
    expect(user.timezone).toBe('Europe/Minsk');
    expect(user.timezoneConfirmed).toBe(true);
  });

  test('setTimezone rejects a non-IANA zone without touching the row', async () => {
    await trackerService.getOrCreateUser(UID);
    await expect(trackerService.setTimezone(UID, 'nope')).rejects.toThrow(/Invalid time zone/);
    const user = await trackerService.getOrCreateUser(UID);
    expect(user.timezoneConfirmed).toBe(false);
  });

  test('setTimezone for a telegram id with no user row throws NotFoundError', async () => {
    await expect(trackerService.setTimezone(999, 'Europe/Minsk')).rejects.toThrow(NotFoundError);
  });
});

describe('trackers', () => {
  test('createTracker defaults to active, and getTrackers only returns the caller\'s own, in id order', async () => {
    const a = await trackerService.createTracker(UID, 'Утро');
    const b = await trackerService.createTracker(UID, 'Вечер');
    await trackerService.createTracker(OTHER_UID, 'Чужой');

    const list = await trackerService.getTrackers(UID);
    expect(list.map((t) => t.id)).toEqual([a.id, b.id]);
    expect(list.every((t) => t.isActive)).toBe(true);
  });

  test('getActiveTrackers excludes paused ones; getTrackers still includes them', async () => {
    const active = await trackerService.createTracker(UID, 'Активный');
    const paused = await trackerService.createTracker(UID, 'На паузе');
    await trackerService.setTrackerActive(UID, paused.id, false);

    const activeOnly = await trackerService.getActiveTrackers(UID);
    expect(activeOnly.map((t) => t.id)).toEqual([active.id]);

    const all = await trackerService.getTrackers(UID);
    expect(all.map((t) => t.id).sort()).toEqual([active.id, paused.id].sort());
  });

  test('getTracker throws NotFoundError for someone else\'s tracker, without leaking whether the id exists', async () => {
    const tracker = await trackerService.createTracker(OTHER_UID, 'Чужой');
    await expect(trackerService.getTracker(UID, tracker.id)).rejects.toThrow(NotFoundError);
    await expect(trackerService.getTracker(UID, 999999)).rejects.toThrow(NotFoundError);
  });

  test('updateTrackerName renames; setTrackerActive toggles, both ownership-checked', async () => {
    const tracker = await trackerService.createTracker(UID, 'Старое имя');
    const renamed = await trackerService.updateTrackerName(UID, tracker.id, 'Новое имя');
    expect(renamed.name).toBe('Новое имя');

    const paused = await trackerService.setTrackerActive(UID, tracker.id, false);
    expect(paused.isActive).toBe(false);

    const someoneElses = await trackerService.createTracker(OTHER_UID, 'Чужой');
    await expect(trackerService.updateTrackerName(UID, someoneElses.id, 'x')).rejects.toThrow(NotFoundError);
    await expect(trackerService.setTrackerActive(UID, someoneElses.id, false)).rejects.toThrow(NotFoundError);
  });

  test('deleteTracker removes it and cascades to its items, their daily_logs, and their reminders', async () => {
    const tracker = await trackerService.createTracker(UID, 'Трекер');
    const item = await trackerService.createItem(UID, tracker.id, 'Пункт');
    await trackerService.setItemChecked(UID, item.id, '2026-01-01', true);
    await trackerService.setReminderTime(UID, item.id, '09:00');

    const deleted = await trackerService.deleteTracker(UID, tracker.id);
    expect(deleted.id).toBe(tracker.id);

    await expect(trackerService.getTracker(UID, tracker.id)).rejects.toThrow(NotFoundError);
    const candidates = await trackerService.getReminderCandidates();
    expect(candidates).toEqual([]);
  });

  test('deleteTracker on someone else\'s tracker throws without deleting anything', async () => {
    const tracker = await trackerService.createTracker(OTHER_UID, 'Чужой');
    await expect(trackerService.deleteTracker(UID, tracker.id)).rejects.toThrow(NotFoundError);
    await expect(trackerService.getTracker(OTHER_UID, tracker.id)).resolves.toMatchObject({ id: tracker.id });
  });
});

describe('items', () => {
  test('createItem appends after existing items (order increments), scoped to the tracker', async () => {
    const tracker = await trackerService.createTracker(UID, 'Трекер');
    const a = await trackerService.createItem(UID, tracker.id, 'Первый');
    const b = await trackerService.createItem(UID, tracker.id, 'Второй');

    expect(a.order).toBe(1);
    expect(b.order).toBe(2);
  });

  test('createItem on a tracker you don\'t own throws NotFoundError', async () => {
    const tracker = await trackerService.createTracker(OTHER_UID, 'Чужой');
    await expect(trackerService.createItem(UID, tracker.id, 'x')).rejects.toThrow(NotFoundError);
  });

  test('getItem is ownership-checked and resolves reminderTime through the join -- null when unset', async () => {
    const tracker = await trackerService.createTracker(UID, 'Трекер');
    const item = await trackerService.createItem(UID, tracker.id, 'Пункт');

    const fetched = await trackerService.getItem(UID, item.id);
    expect(fetched.reminderTime).toBeNull();
    await expect(trackerService.getItem(OTHER_UID, item.id)).rejects.toThrow(NotFoundError);
  });

  test('getItems returns items in order, each with its own reminderTime (or null)', async () => {
    const tracker = await trackerService.createTracker(UID, 'Трекер');
    const a = await trackerService.createItem(UID, tracker.id, 'A');
    const b = await trackerService.createItem(UID, tracker.id, 'B');
    await trackerService.setReminderTime(UID, b.id, '08:30');

    const items = await trackerService.getItems(UID, tracker.id);
    expect(items.map((i) => ({ id: i.id, reminderTime: i.reminderTime }))).toEqual([
      { id: a.id, reminderTime: null },
      { id: b.id, reminderTime: '08:30' },
    ]);
  });

  test('updateItemLabel renames, ownership-checked', async () => {
    const tracker = await trackerService.createTracker(UID, 'Трекер');
    const item = await trackerService.createItem(UID, tracker.id, 'Старое');
    const updated = await trackerService.updateItemLabel(UID, item.id, 'Новое');
    expect(updated.label).toBe('Новое');

    const someoneElsesTracker = await trackerService.createTracker(OTHER_UID, 'Чужой');
    const someoneElsesItem = await trackerService.createItem(OTHER_UID, someoneElsesTracker.id, 'x');
    await expect(trackerService.updateItemLabel(UID, someoneElsesItem.id, 'y')).rejects.toThrow(NotFoundError);
  });

  test('deleteItem removes it and cascades its daily_logs and reminder, ownership-checked', async () => {
    const tracker = await trackerService.createTracker(UID, 'Трекер');
    const item = await trackerService.createItem(UID, tracker.id, 'Пункт');
    await trackerService.setItemChecked(UID, item.id, '2026-01-01', true);
    await trackerService.setReminderTime(UID, item.id, '09:00');

    const deleted = await trackerService.deleteItem(UID, item.id);
    expect(deleted.id).toBe(item.id);
    await expect(trackerService.getItem(UID, item.id)).rejects.toThrow(NotFoundError);
    expect(await trackerService.getReminderCandidates()).toEqual([]);
  });

  describe('moveItem', () => {
    async function threeItems() {
      const tracker = await trackerService.createTracker(UID, 'Трекер');
      const a = await trackerService.createItem(UID, tracker.id, 'A');
      const b = await trackerService.createItem(UID, tracker.id, 'B');
      const c = await trackerService.createItem(UID, tracker.id, 'C');
      return { tracker, a, b, c };
    }

    test('swaps with the neighbour in the given direction', async () => {
      const { tracker, a, b } = await threeItems();
      await trackerService.moveItem(UID, b.id, 'up');
      const items = await trackerService.getItems(UID, tracker.id);
      expect(items.map((i) => i.id)).toEqual([b.id, a.id, (await trackerService.getItems(UID, tracker.id))[2].id]);
    });

    test('moving the first item up (or the last item down) is a no-op, not an error, without `circular`', async () => {
      const { tracker, a, c } = await threeItems();
      await trackerService.moveItem(UID, a.id, 'up');
      await trackerService.moveItem(UID, c.id, 'down');
      const items = await trackerService.getItems(UID, tracker.id);
      expect(items.map((i) => i.id)).toEqual([a.id, items[1].id, c.id]);
    });

    test('with `circular`, moving past an edge wraps to the opposite end', async () => {
      const { tracker, a, c } = await threeItems();
      await trackerService.moveItem(UID, a.id, 'up', { circular: true });
      const items = await trackerService.getItems(UID, tracker.id);
      expect(items[items.length - 1].id).toBe(a.id);
      expect(items[0].id).not.toBe(a.id);
      void c;
    });

    test('circular move is a no-op for a single-item list (its own opposite end)', async () => {
      const tracker = await trackerService.createTracker(UID, 'Трекер');
      const only = await trackerService.createItem(UID, tracker.id, 'Один');
      await expect(trackerService.moveItem(UID, only.id, 'up', { circular: true })).resolves.toEqual({
        trackerId: tracker.id,
      });
    });

    test('throws NotFoundError for an item you don\'t own', async () => {
      const someoneElsesTracker = await trackerService.createTracker(OTHER_UID, 'Чужой');
      const someoneElsesItem = await trackerService.createItem(OTHER_UID, someoneElsesTracker.id, 'x');
      await expect(trackerService.moveItem(UID, someoneElsesItem.id, 'up')).rejects.toThrow(NotFoundError);
    });
  });
});

describe('reminders', () => {
  async function itemFixture() {
    const tracker = await trackerService.createTracker(UID, 'Трекер');
    return trackerService.createItem(UID, tracker.id, 'Пункт');
  }

  test('setReminderTime validates the HH:MM format', async () => {
    const item = await itemFixture();
    await expect(trackerService.setReminderTime(UID, item.id, '25:00')).rejects.toThrow(/Invalid reminder time/);
    await expect(trackerService.setReminderTime(UID, item.id, '9:00')).rejects.toThrow(/Invalid reminder time/);
    await expect(trackerService.setReminderTime(UID, item.id, '09:60')).rejects.toThrow(/Invalid reminder time/);
  });

  test('setReminderTime is ownership-checked', async () => {
    const item = await itemFixture();
    await expect(trackerService.setReminderTime(OTHER_UID, item.id, '09:00')).rejects.toThrow(NotFoundError);
  });

  test('set then clear (null) removes it -- getItem reflects both states', async () => {
    const item = await itemFixture();
    await trackerService.setReminderTime(UID, item.id, '09:00');
    expect((await trackerService.getItem(UID, item.id)).reminderTime).toBe('09:00');

    await trackerService.setReminderTime(UID, item.id, null);
    expect((await trackerService.getItem(UID, item.id)).reminderTime).toBeNull();
  });

  test('rescheduling to a DIFFERENT time clears the "already sent today" marker', async () => {
    const item = await itemFixture();
    await trackerService.setReminderTime(UID, item.id, '09:00');
    await trackerService.recordReminderSent(item.id, '2026-01-01');
    expect(await trackerService.hasReminderLog(item.id, '2026-01-01')).toBe(true);

    await trackerService.setReminderTime(UID, item.id, '15:00');
    expect(await trackerService.hasReminderLog(item.id, '2026-01-01')).toBe(false);
  });

  test('re-saving the SAME time keeps the "already sent today" marker (no accidental re-send)', async () => {
    const item = await itemFixture();
    await trackerService.setReminderTime(UID, item.id, '09:00');
    await trackerService.recordReminderSent(item.id, '2026-01-01');

    await trackerService.setReminderTime(UID, item.id, '09:00');
    expect(await trackerService.hasReminderLog(item.id, '2026-01-01')).toBe(true);
  });

  test('clearing the reminder also clears the marker, so re-adding the same time the same day can still fire', async () => {
    const item = await itemFixture();
    await trackerService.setReminderTime(UID, item.id, '09:00');
    await trackerService.recordReminderSent(item.id, '2026-01-01');

    await trackerService.setReminderTime(UID, item.id, null);
    await trackerService.setReminderTime(UID, item.id, '09:00');
    expect(await trackerService.hasReminderLog(item.id, '2026-01-01')).toBe(false);
  });

  test('getReminderCandidates: only items with a reminder, on an active tracker, joined with the owner\'s timezone', async () => {
    await trackerService.getOrCreateUser(UID);
    await trackerService.setTimezone(UID, 'Europe/Minsk');

    const tracker = await trackerService.createTracker(UID, 'Утро');
    const withReminder = await trackerService.createItem(UID, tracker.id, 'С напоминанием');
    await trackerService.createItem(UID, tracker.id, 'Без напоминания');
    await trackerService.setReminderTime(UID, withReminder.id, '07:15');

    const pausedTracker = await trackerService.createTracker(UID, 'На паузе');
    const pausedItem = await trackerService.createItem(UID, pausedTracker.id, 'Пункт паузы');
    await trackerService.setReminderTime(UID, pausedItem.id, '07:15');
    await trackerService.setTrackerActive(UID, pausedTracker.id, false);

    const candidates = await trackerService.getReminderCandidates();
    expect(candidates).toEqual([
      {
        itemId: withReminder.id,
        itemLabel: 'С напоминанием',
        trackerId: tracker.id,
        trackerName: 'Утро',
        telegramId: UID,
        reminderTime: '07:15',
        timezone: 'Europe/Minsk',
      },
    ]);
  });

  test('hasReminderLog/recordReminderSent round-trip, and reject a malformed date', async () => {
    const item = await itemFixture();
    await trackerService.setReminderTime(UID, item.id, '09:00');

    expect(await trackerService.hasReminderLog(item.id, '2026-01-01')).toBe(false);
    await trackerService.recordReminderSent(item.id, '2026-01-01');
    expect(await trackerService.hasReminderLog(item.id, '2026-01-01')).toBe(true);
    expect(await trackerService.hasReminderLog(item.id, '2026-01-02')).toBe(false);

    await expect(trackerService.hasReminderLog(item.id, '01-01-2026')).rejects.toThrow(/Invalid date/);
    await expect(trackerService.recordReminderSent(item.id, 'not-a-date')).rejects.toThrow(/Invalid date/);
  });
});

describe('day log', () => {
  test('getDayLog defaults every item to unchecked when there is no log row yet', async () => {
    const tracker = await trackerService.createTracker(UID, 'Трекер');
    await trackerService.createItem(UID, tracker.id, 'Пункт');

    const log = await trackerService.getDayLog(UID, tracker.id, '2026-01-01');
    expect(log).toHaveLength(1);
    expect(log[0].checked).toBe(false);
  });

  test('setItemChecked sets (not toggles): repeating the same call keeps the same state', async () => {
    const tracker = await trackerService.createTracker(UID, 'Трекер');
    const item = await trackerService.createItem(UID, tracker.id, 'Пункт');

    await trackerService.setItemChecked(UID, item.id, '2026-01-01', true);
    await trackerService.setItemChecked(UID, item.id, '2026-01-01', true);
    expect(await trackerService.isItemChecked(item.id, '2026-01-01')).toBe(true);

    await trackerService.setItemChecked(UID, item.id, '2026-01-01', false);
    expect(await trackerService.isItemChecked(item.id, '2026-01-01')).toBe(false);
  });

  test('checked state is per day: checking today does not affect yesterday or tomorrow', async () => {
    const tracker = await trackerService.createTracker(UID, 'Трекер');
    const item = await trackerService.createItem(UID, tracker.id, 'Пункт');

    await trackerService.setItemChecked(UID, item.id, '2026-01-02', true);
    expect(await trackerService.isItemChecked(item.id, '2026-01-01')).toBe(false);
    expect(await trackerService.isItemChecked(item.id, '2026-01-02')).toBe(true);
    expect(await trackerService.isItemChecked(item.id, '2026-01-03')).toBe(false);
  });

  test('getDayLog/setItemChecked are ownership-checked and reject malformed dates', async () => {
    const tracker = await trackerService.createTracker(UID, 'Трекер');
    const item = await trackerService.createItem(UID, tracker.id, 'Пункт');

    await expect(trackerService.getDayLog(OTHER_UID, tracker.id, '2026-01-01')).rejects.toThrow(NotFoundError);
    await expect(trackerService.setItemChecked(OTHER_UID, item.id, '2026-01-01', true)).rejects.toThrow(
      NotFoundError,
    );
    await expect(trackerService.getDayLog(UID, tracker.id, '01-01-2026')).rejects.toThrow(/Invalid date/);
    await expect(trackerService.setItemChecked(UID, item.id, 'nope', true)).rejects.toThrow(/Invalid date/);
  });
});
