import { GrammyError } from 'grammy';

/** Telegram rejects an edit that would leave the message exactly as it is; that is not a failure. */
export function isMessageNotModified(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    error.description.includes('message is not modified')
  );
}
