import type { ScheduledTask } from 'node-cron';
import { createBot } from './bot';
import { loadBotConfig } from './config';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './db';
import { logger } from './logger';
import { startReminderScheduler } from './scheduler/reminders';

async function main(): Promise<void> {
  try {
    migrate(db, { migrationsFolder: './drizzle' });

    const { botToken } = loadBotConfig();
    const bot = createBot(botToken);

    let reminderTask: ScheduledTask | undefined;
    process.once('SIGINT', () => {
      reminderTask?.stop();
      void bot.stop();
    });
    process.once('SIGTERM', () => {
      reminderTask?.stop();
      void bot.stop();
    });

    await bot.start({
      onStart: () => {
        reminderTask = startReminderScheduler(bot);
      },
    });
  } catch (error) {
    logger.error('Failed to start bot', { error });
    process.exit(1);
  }
}

void main();
