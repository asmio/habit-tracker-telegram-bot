import { sequentialize } from '@grammyjs/runner';
import { Bot } from 'grammy';
import { registerHandlers } from '../handlers';
import { logger } from '../logger';

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // Without this, two updates from the same user (e.g. a redelivered update after a restart, or a
  // fast double-tap) can be handled concurrently and race on the in-memory "current screen" state
  // in ui/screen.ts, producing duplicate or out-of-order messages. This serializes per-chat instead.
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));

  registerHandlers(bot);

  // Without this grammY stops the whole bot on the first handler error.
  bot.catch(({ error, ctx }) => {
    logger.error('Unhandled error while processing update', {
      updateId: ctx.update.update_id,
      error,
    });
  });

  return bot;
}
