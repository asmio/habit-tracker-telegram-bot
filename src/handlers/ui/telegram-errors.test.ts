import { GrammyError } from 'grammy';
import { deleteMessageSafely, isMessageNotModified } from './telegram-errors';

function grammyError(error_code: number, description: string): GrammyError {
  return new GrammyError(description, { ok: false, error_code, description }, 'editMessageText', {});
}

describe('isMessageNotModified', () => {
  test('true for Telegram\'s "message is not modified" 400 error', () => {
    expect(isMessageNotModified(grammyError(400, 'Bad Request: message is not modified'))).toBe(true);
  });

  test('false for a different 400 error, a different error code, or a non-GrammyError', () => {
    expect(isMessageNotModified(grammyError(400, 'Bad Request: message to edit not found'))).toBe(false);
    expect(isMessageNotModified(grammyError(429, 'Too Many Requests'))).toBe(false);
    expect(isMessageNotModified(new Error('message is not modified'))).toBe(false);
    expect(isMessageNotModified('message is not modified')).toBe(false);
  });
});

describe('deleteMessageSafely', () => {
  test('calls ctx.deleteMessage and resolves', async () => {
    const deleteMessage = jest.fn().mockResolvedValue(true);
    await deleteMessageSafely({ deleteMessage } as never);
    expect(deleteMessage).toHaveBeenCalledTimes(1);
  });

  test('swallows a rejection instead of throwing (the message may already be gone)', async () => {
    const deleteMessage = jest.fn().mockRejectedValue(new Error('message to delete not found'));
    await expect(deleteMessageSafely({ deleteMessage } as never)).resolves.toBeUndefined();
  });
});
