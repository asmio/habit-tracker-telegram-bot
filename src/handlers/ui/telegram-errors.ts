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
 * Deletes the update's own incoming message -- Telegram allows a bot to delete incoming messages
 * in private chats (unlike other chats' messages, which it can never touch). Used right after a
 * pending text prompt consumes its answer, so the reply that answered it doesn't linger in the
 * chat once its content has already moved into the current screen. Best-effort: the message may
 * already be gone (a double-submit, the user deleting it themselves), which is not worth failing
 * the flow over.
 */
export async function deleteMessageSafely(ctx: Context): Promise<void> {
  try {
    await ctx.deleteMessage();
  } catch {
    // Not worth surfacing: the screen already reflects the answer either way.
  }
}
