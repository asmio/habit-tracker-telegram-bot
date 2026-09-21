import type { Context } from 'grammy';

/**
 * Text of the bot's own message that the user is replying to, if any.
 * Prompts sent with `force_reply` are the conversation state: nothing is kept in memory,
 * so a restart cannot lose a pending question and unrelated messages are never mistaken for answers.
 */
export function getBotPromptText(ctx: Context): string | undefined {
  const prompt = ctx.msg?.reply_to_message;
  return prompt?.from?.id === ctx.me.id ? prompt.text : undefined;
}
