import { and, asc, desc, eq, getTableColumns, gt, lt, sql } from 'drizzle-orm';
import { db, type Db } from '../db';
import {
  dailyLogs,
  trackerItems,
  trackers,
  users,
  type Tracker,
  type TrackerItem,
  type User,
} from '../db/schema';
import { NotFoundError } from './errors';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type DayLogItem = TrackerItem & { checked: boolean };

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
  async getItem(telegramId: number, itemId: number): Promise<TrackerItem> {
    const [item] = await this.db
      .select(getTableColumns(trackerItems))
      .from(trackerItems)
      .innerJoin(trackers, eq(trackers.id, trackerItems.trackerId))
      .where(and(eq(trackerItems.id, itemId), eq(trackers.telegramId, telegramId)));
    if (!item) {
      throw new NotFoundError(`Item ${itemId} not found`);
    }
    return item;
  }

  /** Items of the tracker, in order, without any daily_logs state. */
  async getItems(telegramId: number, trackerId: number): Promise<TrackerItem[]> {
    await this.getTracker(telegramId, trackerId);
    return await this.db
      .select()
      .from(trackerItems)
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
   * either end of the list, so a stale ⬆️/⬇️ tap on an edge item does nothing instead of failing.
   * Runs as a single transaction: better-sqlite3 executes it fully synchronously, so the read of
   * the neighbour's position can never go stale between reading it and swapping the two rows.
   */
  async moveItem(telegramId: number, itemId: number, direction: 'up' | 'down'): Promise<{ trackerId: number }> {
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

      const neighbor =
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

      if (neighbor) {
        tx.update(trackerItems).set({ order: neighbor.order }).where(eq(trackerItems.id, current.id)).run();
        tx.update(trackerItems).set({ order: current.order }).where(eq(trackerItems.id, neighbor.id)).run();
      }

      return { trackerId: current.trackerId };
    });
  }

  /** Items of the tracker with their `checked` state for today in the owner's time zone. */
  async getTodayLog(trackerId: number): Promise<DayLogItem[]> {
    const [owner] = await this.db
      .select({ timezone: users.timezone })
      .from(trackers)
      .innerJoin(users, eq(users.telegramId, trackers.telegramId))
      .where(eq(trackers.id, trackerId));
    if (!owner) return [];

    return await this.queryDayLog(trackerId, todayDate(owner.timezone));
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
      .select({ ...getTableColumns(trackerItems), checked: dailyLogs.checked })
      .from(trackerItems)
      .leftJoin(dailyLogs, and(eq(dailyLogs.itemId, trackerItems.id), eq(dailyLogs.date, date)))
      .where(eq(trackerItems.trackerId, trackerId))
      .orderBy(asc(trackerItems.order), asc(trackerItems.id));

    // No log row for the day means the item has not been checked.
    return rows.map((row) => ({ ...row, checked: row.checked ?? false }));
  }
}

export const trackerService = new TrackerService(db);
