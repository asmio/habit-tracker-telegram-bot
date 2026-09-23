import { createBot } from './bot';
import { loadBotConfig } from './config';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './db';
import { logger } from './logger';

async function main(): Promise<void> {
  try {
    migrate(db, { migrationsFolder: './drizzle' });
    
    const { botToken } = loadBotConfig();
    const bot = createBot(botToken);

    process.once('SIGINT', () => void bot.stop());
    process.once('SIGTERM', () => void bot.stop());

    await bot.start();
  } catch (error) {
    logger.error('Failed to start bot', { error });
    process.exit(1);
  }
}

void main();
