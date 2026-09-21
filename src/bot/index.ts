import { Bot } from 'grammy';
import { registerHandlers } from '../handlers';
import { logger } from '../logger';

export function createBot(token: string): Bot {
  const bot = new Bot(token);
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
