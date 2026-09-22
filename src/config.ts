import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

function parseEnv<T extends z.ZodType>(schema: T): z.output<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

const botEnvSchema = z.object({
  BOT_TOKEN: z.string().min(1),
});

const dbEnvSchema = z.object({
  DB_PATH: z.string().min(1).default('./data/habit-tracker.db'),
});

export function loadBotConfig() {
  const env = parseEnv(botEnvSchema);
  return { botToken: env.BOT_TOKEN };
}

export function loadDbConfig() {
  const env = parseEnv(dbEnvSchema);

  // Neither better-sqlite3 nor drizzle-kit create the database file's parent directory.
  if (env.DB_PATH !== ':memory:') {
    mkdirSync(dirname(env.DB_PATH), { recursive: true });
  }

  return { dbPath: env.DB_PATH };
}
