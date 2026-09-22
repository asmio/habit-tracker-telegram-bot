import { GrammyError, type Context } from 'grammy';

/** Telegram rejects an edit that would leave the message exactly as it is; that is not a failure. */
export function isMessageNotModified(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    error.description.includes('message is not modified')
  );
}

/**
 * Edits the current message's text and keyboard, silently ignoring Telegram's "message is not
 * modified" error -- the harmless result of a double tap landing on a screen that already shows
 * what the tap would have produced (e.g. a repeated "← Назад" or the same tracker picked twice).
 */
export async function editMessageTextSafely(
  ctx: Context,
  text: string,
  other: NonNullable<Parameters<Context['editMessageText']>[1]>,
): Promise<void> {
  try {
    await ctx.editMessageText(text, other);
  } catch (error) {
    if (!isMessageNotModified(error)) throw error;
  }
}
