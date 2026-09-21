import 'dotenv/config';
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
  DB_PATH: z.string().min(1).default('./habit-tracker.db'),
});

export function loadBotConfig() {
  const env = parseEnv(botEnvSchema);
  return { botToken: env.BOT_TOKEN };
}

export function loadDbConfig() {
  const env = parseEnv(dbEnvSchema);
  return { dbPath: env.DB_PATH };
}
