import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const createdAt = () => text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`);

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').notNull().unique(),
  /** IANA time zone name, e.g. `Europe/Minsk`. Decides which calendar day is "today" for the user. */
  timezone: text('timezone').notNull().default('UTC'),
  /** False until the user has picked a time zone; `timezone` above is only a fallback until then. */
  timezoneConfirmed: integer('timezone_confirmed', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

export const trackers = sqliteTable('trackers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id')
    .notNull()
    .references(() => users.telegramId, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** False = paused: hidden from "Сегодня", items and history stay untouched. */
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
});

export const trackerItems = sqliteTable('tracker_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  trackerId: integer('tracker_id')
    .notNull()
    .references(() => trackers.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  order: integer('order').notNull().default(0),
  createdAt: createdAt(),
});

/**
 * The one message per user the bot treats as "the screen" (see `ui/screen.ts`), so it survives
 * restarts. No foreign key to `users` on purpose: a session may be written for a button tapped on
 * an old message before that user's row exists again (e.g. after a database reset).
 */
export const userSessions = sqliteTable('user_sessions', {
  telegramId: integer('telegram_id').primaryKey(),
  messageId: integer('message_id').notNull(),
  /** Route of the screen shown in `messageId`, in `callback_data` format (e.g. `trackers:open:5`). */
  screen: text('screen').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const dailyLogs = sqliteTable(
  'daily_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemId: integer('item_id')
      .notNull()
      .references(() => trackerItems.id, { onDelete: 'cascade' }),
    /** Calendar day in `YYYY-MM-DD` format, in the owner's time zone. */
    date: text('date').notNull(),
    checked: integer('checked', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    uniqueIndex('daily_logs_item_id_date_unique').on(table.itemId, table.date),
    // SQLite is loosely typed: these keep malformed values out at the DB level.
    // `date()` returns NULL or a normalised value for anything but a real `YYYY-MM-DD` day.
    check('daily_logs_date_is_iso_date', sql`date(${table.date}) IS ${table.date}`),
    check('daily_logs_checked_is_boolean', sql`${table.checked} IN (0, 1)`),
  ],
);

/**
 * A reminder is a separate, optional concept bolted onto an item, not a property of it: an item
 * either has one (a row here) or doesn't (no row) -- `itemId` is this table's own primary key,
 * not just a foreign key, which is what makes "has a reminder" a row's existence rather than a
 * nullable sentinel column. Keeping it out of `tracker_items` also means this table (and only this
 * one) pays for any future reminder schema churn -- `tracker_items` no longer needs a CHECK
 * constraint at all, so plain `ADD COLUMN`s to it stay simple ALTERs instead of SQLite's
 * rebuild-the-whole-table dance that a CHECK constraint forces.
 */
export const reminders = sqliteTable(
  'reminders',
  {
    itemId: integer('item_id')
      .primaryKey()
      .references(() => trackerItems.id, { onDelete: 'cascade' }),
    /** `HH:MM` in the owner's time zone to send the daily reminder at. */
    time: text('time').notNull(),
    /**
     * Calendar day (`YYYY-MM-DD`, owner's time zone) this reminder last actually fired -- at most
     * one reminder per item per day, so this one column is all the "already sent today?" state
     * needs. `TrackerService.setReminderTime` nulls it out whenever `time` actually changes, so a
     * reschedule later the same day can still fire instead of being blocked by it.
     */
    lastSentDate: text('last_sent_date'),
  },
  (table) => [
    // GLOB (not a check against a single pattern) because SQLite has no regex alternation: an
    // `HH` of 00-19 is any digit in the second place, but 20-23 only allows 0-3.
    check(
      'reminders_time_is_hh_mm',
      sql`${table.time} GLOB '[0-1][0-9]:[0-5][0-9]' OR ${table.time} GLOB '2[0-3]:[0-5][0-9]'`,
    ),
    check(
      'reminders_last_sent_date_is_iso_date',
      sql`${table.lastSentDate} IS NULL OR date(${table.lastSentDate}) IS ${table.lastSentDate}`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type Tracker = typeof trackers.$inferSelect;
export type TrackerItem = typeof trackerItems.$inferSelect;
export type UserSession = typeof userSessions.$inferSelect;
