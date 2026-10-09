import { and, asc, desc, eq, getTableColumns, gt, lt, sql } from 'drizzle-orm';
import { db, type Db } from '../db';
import {
  dailyLogs,
  reminders,
  trackerItems,
  trackers,
  users,
  type Tracker,
  type TrackerItem,
  type User,
} from '../db/schema';
import { NotFoundError } from './errors';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REMINDER_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** An item, plus its reminder time if it has one set -- `null` otherwise. What every item-reading method returns. */
type ItemWithReminder = TrackerItem & { reminderTime: string | null };
type DayLogItem = ItemWithReminder & { checked: boolean };

/** An item with a reminder set, on an active tracker, plus what the scheduler needs to decide whether it's due. */
export interface ReminderCandidate {
  itemId: number;
  itemLabel: string;
  trackerId: number;
  trackerName: string;
  telegramId: number;
  /** `HH:MM` in `timezone`. */
  reminderTime: string;
  timezone: string;
}

/**
 * True for IANA zone names such as `Europe/Minsk`. UTC offsets like `+03:00` are
 * rejected on purpose: `Intl` accepts them, but they ignore daylight saving time.
 */
export function isValidTimezone(timezone: string): boolean {
  if (/^[+-]/.test(timezone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Calendar day (`YYYY-MM-DD`) that `now` falls on in the given IANA time zone. */
export function todayDate(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const { year, month, day } = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${year}-${month}-${day}`;
}

function assertDate(date: string): void {
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  }
}

/**
 * Methods that take an id coming from Telegram (callback data, prompts) also take the
 * caller's `telegramId` and throw `NotFoundError` for rows owned by someone else.
 */
export class TrackerService {
  constructor(private readonly db: Db) {}

  async getOrCreateUser(telegramId: number): Promise<User> {
    await this.db.insert(users).values({ telegramId }).onConflictDoNothing();

    const user = await this.db.query.users.findFirst({
      where: eq(users.telegramId, telegramId),
    });
    if (!user) {
      throw new Error(`Failed to load user with telegram id ${telegramId}`);
    }
    return user;
  }

  /** Saves the zone and marks it as chosen by the user, so the bot stops asking for it. */
  async setTimezone(telegramId: number, timezone: string): Promise<User> {
    if (!isValidTimezone(timezone)) {
      throw new Error(`Invalid time zone "${timezone}", expected an IANA name like "Europe/Minsk"`);
    }

    const [user] = await this.db
      .update(users)
      .set({ timezone, timezoneConfirmed: true })
      .where(eq(users.telegramId, telegramId))
      .returning();
    if (!user) {
      throw new NotFoundError(`User with telegram id ${telegramId} not found`);
    }
    return user;
  }

  async createTracker(telegramId: number, name: string): Promise<Tracker> {
    const [tracker] = await this.db.insert(trackers).values({ telegramId, name }).returning();
    return tracker;
  }

  async getTrackers(telegramId: number): Promise<Tracker[]> {
    return await this.db
      .select()
      .from(trackers)
      .where(eq(trackers.telegramId, telegramId))
      .orderBy(asc(trackers.id));
  }

  /** Same as `getTrackers`, but skips paused ones -- for screens that show only what to act on today. */
  async getActiveTrackers(telegramId: number): Promise<Tracker[]> {
    return await this.db
      .select()
      .from(trackers)
      .where(and(eq(trackers.telegramId, telegramId), eq(trackers.isActive, true)))
      .orderBy(asc(trackers.id));
  }

  async getTracker(telegramId: number, trackerId: number): Promise<Tracker> {
    const [tracker] = await this.db
      .select()
      .from(trackers)
      .where(and(eq(trackers.id, trackerId), eq(trackers.telegramId, telegramId)));
    if (!tracker) {
      throw new NotFoundError(`Tracker ${trackerId} not found`);
    }
    return tracker;
  }

  /** Appends the item after the tracker's existing ones. */
  async createItem(telegramId: number, trackerId: number, label: string): Promise<TrackerItem> {
    await this.getTracker(telegramId, trackerId);

    // The position is computed inside the INSERT itself, so concurrent calls cannot read the same maximum.
    const [item] = await this.db
      .insert(trackerItems)
      .values({
        trackerId,
        label,
        order: sql`(SELECT COALESCE(MAX(${trackerItems.order}), 0) + 1 FROM ${trackerItems} WHERE ${trackerItems.trackerId} = ${trackerId})`,
      })
      .returning();
    return item;
  }

  /** Ownership-checked lookup of a single item. */
  async getItem(telegramId: number, itemId: number): Promise<ItemWithReminder> {
    const [item] = await this.db
      .select({ ...getTableColumns(trackerItems), reminderTime: reminders.time })
      .from(trackerItems)
      .innerJoin(trackers, eq(trackers.id, trackerItems.trackerId))
      .leftJoin(reminders, eq(reminders.itemId, trackerItems.id))
      .where(and(eq(trackerItems.id, itemId), eq(trackers.telegramId, telegramId)));
    if (!item) {
      throw new NotFoundError(`Item ${itemId} not found`);
    }
    return item;
  }

  /** Items of the tracker, in order, without any daily_logs state. */
  async getItems(telegramId: number, trackerId: number): Promise<ItemWithReminder[]> {
    await this.getTracker(telegramId, trackerId);
    return await this.db
      .select({ ...getTableColumns(trackerItems), reminderTime: reminders.time })
      .from(trackerItems)
      .leftJoin(reminders, eq(reminders.itemId, trackerItems.id))
      .where(eq(trackerItems.trackerId, trackerId))
      .orderBy(asc(trackerItems.order), asc(trackerItems.id));
  }

  async updateItemLabel(telegramId: number, itemId: number, label: string): Promise<TrackerItem> {
    await this.getItem(telegramId, itemId);
    const [item] = await this.db
      .update(trackerItems)
      .set({ label })
      .where(eq(trackerItems.id, itemId))
      .returning();
    return item;
  }

  /** `reminderTime` is `HH:MM` in the item's owner's time zone, or `null` to remove the reminder. */
  async setReminderTime(telegramId: number, itemId: number, reminderTime: string | null): Promise<void> {
    if (reminderTime !== null && !REMINDER_TIME_PATTERN.test(reminderTime)) {
      throw new Error(`Invalid reminder time "${reminderTime}", expected HH:MM`);
    }
    await this.getItem(telegramId, itemId); // ownership check

    if (reminderTime === null) {
      await this.db.delete(reminders).where(eq(reminders.itemId, itemId));
      return;
    }

    // A fresh reminder starts with no "already sent" marker. An existing one keeps its marker only
    // if the time didn't actually change -- a real reschedule should still be able to fire today
    // even if the old time already did (see `hasReminderLog`/`recordReminderSent`).
    await this.db
      .insert(reminders)
      .values({ itemId, time: reminderTime, lastSentDate: null })
      .onConflictDoUpdate({
        target: reminders.itemId,
        set: {
          time: reminderTime,
          lastSentDate: sql`CASE WHEN ${reminders.time} = ${reminderTime} THEN ${reminders.lastSentDate} ELSE NULL END`,
        },
      });
  }

  async updateTrackerName(telegramId: number, trackerId: number, name: string): Promise<Tracker> {
    await this.getTracker(telegramId, trackerId);
    const [tracker] = await this.db.update(trackers).set({ name }).where(eq(trackers.id, trackerId)).returning();
    return tracker;
  }

  async setTrackerActive(telegramId: number, trackerId: number, isActive: boolean): Promise<Tracker> {
    await this.getTracker(telegramId, trackerId);
    const [tracker] = await this.db.update(trackers).set({ isActive }).where(eq(trackers.id, trackerId)).returning();
    return tracker;
  }

  /** Deletes the item; `ON DELETE CASCADE` takes its daily_logs rows with it. Returns the item as it was. */
  async deleteItem(telegramId: number, itemId: number): Promise<TrackerItem> {
    const item = await this.getItem(telegramId, itemId);
    await this.db.delete(trackerItems).where(eq(trackerItems.id, itemId));
    return item;
  }

  /**
   * Deletes the tracker; `ON DELETE CASCADE` takes its items and their daily_logs with it.
   * Returns the tracker as it was.
   */
  async deleteTracker(telegramId: number, trackerId: number): Promise<Tracker> {
    const tracker = await this.getTracker(telegramId, trackerId);
    await this.db.delete(trackers).where(eq(trackers.id, trackerId));
    return tracker;
  }

  /**
   * Swaps the item's position with its neighbour in that direction. A no-op (not an error) at
   * either end of the list, so a stale ⬆️/⬇️ tap on an edge item does nothing instead of failing --
   * unless `circular` is set, in which case the "neighbour" at an edge is the item at the opposite
   * end of the list, so repeated taps cycle through positions instead of stopping there.
   * Runs as a single transaction: better-sqlite3 executes it fully synchronously, so the read of
   * the neighbour's position can never go stale between reading it and swapping the two rows.
   */
  async moveItem(
    telegramId: number,
    itemId: number,
    direction: 'up' | 'down',
    options: { circular?: boolean } = {},
  ): Promise<{ trackerId: number }> {
    return this.db.transaction((tx) => {
      const current = tx
        .select({ id: trackerItems.id, trackerId: trackerItems.trackerId, order: trackerItems.order })
        .from(trackerItems)
        .innerJoin(trackers, eq(trackers.id, trackerItems.trackerId))
        .where(and(eq(trackerItems.id, itemId), eq(trackers.telegramId, telegramId)))
        .get();
      if (!current) {
        throw new NotFoundError(`Item ${itemId} not found`);
      }

      let neighbor =
        direction === 'up'
          ? tx
              .select({ id: trackerItems.id, order: trackerItems.order })
              .from(trackerItems)
              .where(and(eq(trackerItems.trackerId, current.trackerId), lt(trackerItems.order, current.order)))
              .orderBy(desc(trackerItems.order))
              .limit(1)
              .get()
          : tx
              .select({ id: trackerItems.id, order: trackerItems.order })
              .from(trackerItems)
              .where(and(eq(trackerItems.trackerId, current.trackerId), gt(trackerItems.order, current.order)))
              .orderBy(asc(trackerItems.order))
              .limit(1)
              .get();

      if (!neighbor && options.circular) {
        neighbor =
          direction === 'up'
            ? tx
                .select({ id: trackerItems.id, order: trackerItems.order })
                .from(trackerItems)
                .where(eq(trackerItems.trackerId, current.trackerId))
                .orderBy(desc(trackerItems.order))
                .limit(1)
                .get()
            : tx
                .select({ id: trackerItems.id, order: trackerItems.order })
                .from(trackerItems)
                .where(eq(trackerItems.trackerId, current.trackerId))
                .orderBy(asc(trackerItems.order))
                .limit(1)
                .get();
        // A single-item list's "opposite end" is the item itself: nothing to swap.
        if (neighbor?.id === current.id) neighbor = undefined;
      }

      if (neighbor) {
        tx.update(trackerItems).set({ order: neighbor.order }).where(eq(trackerItems.id, current.id)).run();
        tx.update(trackerItems).set({ order: current.order }).where(eq(trackerItems.id, neighbor.id)).run();
      }

      return { trackerId: current.trackerId };
    });
  }

  /** Items of the tracker with their `checked` state for an arbitrary day. */
  async getDayLog(telegramId: number, trackerId: number, date: string): Promise<DayLogItem[]> {
    assertDate(date);
    await this.getTracker(telegramId, trackerId);
    return await this.queryDayLog(trackerId, date);
  }

  /**
   * Sets (not flips) `checked` for the item on the given day, so repeating the same
   * request, e.g. from an outdated message, cannot undo it. Returns the item's tracker.
   */
  async setItemChecked(
    telegramId: number,
    itemId: number,
    date: string,
    checked: boolean,
  ): Promise<{ trackerId: number }> {
    assertDate(date);
    const item = await this.getItem(telegramId, itemId);

    await this.db
      .insert(dailyLogs)
      .values({ itemId, date, checked })
      .onConflictDoUpdate({ target: [dailyLogs.itemId, dailyLogs.date], set: { checked } });
    return { trackerId: item.trackerId };
  }

  private async queryDayLog(trackerId: number, date: string): Promise<DayLogItem[]> {
    const rows = await this.db
      .select({ ...getTableColumns(trackerItems), checked: dailyLogs.checked, reminderTime: reminders.time })
      .from(trackerItems)
      .leftJoin(dailyLogs, and(eq(dailyLogs.itemId, trackerItems.id), eq(dailyLogs.date, date)))
      .leftJoin(reminders, eq(reminders.itemId, trackerItems.id))
      .where(eq(trackerItems.trackerId, trackerId))
      .orderBy(asc(trackerItems.order), asc(trackerItems.id));

    // No log row for the day means the item has not been checked.
    return rows.map((row) => ({ ...row, checked: row.checked ?? false }));
  }

  /**
   * Every item with a reminder set, on a tracker that isn't paused -- the scheduler's own source of
   * truth for what might be due, re-read fresh on every tick rather than cached, since items, their
   * reminder times, and tracker pause state can all change between ticks.
   */
  async getReminderCandidates(): Promise<ReminderCandidate[]> {
    return await this.db
      .select({
        itemId: trackerItems.id,
        itemLabel: trackerItems.label,
        trackerId: trackers.id,
        trackerName: trackers.name,
        telegramId: trackers.telegramId,
        reminderTime: reminders.time,
        timezone: users.timezone,
      })
      .from(reminders)
      .innerJoin(trackerItems, eq(trackerItems.id, reminders.itemId))
      .innerJoin(trackers, eq(trackers.id, trackerItems.trackerId))
      .innerJoin(users, eq(users.telegramId, trackers.telegramId))
      .where(eq(trackers.isActive, true));
  }

  /** Whether a reminder was already sent for this item on this day (see `recordReminderSent`). */
  async hasReminderLog(itemId: number, date: string): Promise<boolean> {
    assertDate(date);
    const [row] = await this.db
      .select({ lastSentDate: reminders.lastSentDate })
      .from(reminders)
      .where(eq(reminders.itemId, itemId));
    return row?.lastSentDate === date;
  }

  /** Whether the item is already checked for this day -- a reminder for it would be pointless. */
  async isItemChecked(itemId: number, date: string): Promise<boolean> {
    assertDate(date);
    const [row] = await this.db
      .select({ checked: dailyLogs.checked })
      .from(dailyLogs)
      .where(and(eq(dailyLogs.itemId, itemId), eq(dailyLogs.date, date)));
    return row?.checked ?? false;
  }

  /** Marks the reminder as sent, so `hasReminderLog` skips it for the rest of the day. */
  async recordReminderSent(itemId: number, date: string): Promise<void> {
    assertDate(date);
    await this.db.update(reminders).set({ lastSentDate: date }).where(eq(reminders.itemId, itemId));
  }
}

export const trackerService = new TrackerService(db);
