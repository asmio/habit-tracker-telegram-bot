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
  description: text('description'),
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

export type User = typeof users.$inferSelect;
export type Tracker = typeof trackers.$inferSelect;
export type TrackerItem = typeof trackerItems.$inferSelect;
