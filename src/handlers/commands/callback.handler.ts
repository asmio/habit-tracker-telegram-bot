import { Bot } from 'grammy';
import { logger } from '../../logger';
import { NotFoundError } from '../../services/errors';
import { trackerService } from '../../services/tracker.service';
import { isMessageNotModified } from '../ui/telegram-errors';
import { isCheckedButtonText, TOGGLE_CALLBACK_PATTERN, trackerKeyboard } from '../ui/toggle-button';

export function registerCallbackHandler(bot: Bot): void {
  bot.callbackQuery(TOGGLE_CALLBACK_PATTERN, async (ctx) => {
    const [data, itemIdText, date] = ctx.match;
    const itemId = Number(itemIdText);

    // Telegram stops providing the keyboard for messages that are too old to be edited.
    const message = ctx.callbackQuery.message;
    const rows = message && 'reply_markup' in message ? message.reply_markup?.inline_keyboard : undefined;
    const pressed = rows?.flat().find((button) => 'callback_data' in button && button.callback_data === data);
    if (!pressed) {
      await ctx.answerCallbackQuery({ text: 'Сообщение устарело. Открой /today заново.' });
      return;
    }

    // The button shows what the user sees, and that is what they want to change (☐ → check, ☑ → uncheck),
    // even if this message is out of date and the database says otherwise.
    const checked = !isCheckedButtonText(pressed.text);

    let trackerId: number;
    try {
      ({ trackerId } = await trackerService.setItemChecked(ctx.from.id, itemId, date, checked));
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('Toggle for an item the user does not own', { telegramId: ctx.from.id, itemId });
        await ctx.answerCallbackQuery({ text: 'Пункт не найден.' });
        return;
      }
      // Stop the button's loading spinner and tell the user; the error itself is logged by bot.catch.
      await ctx.answerCallbackQuery({ text: 'Не удалось обновить пункт. Попробуй ещё раз.' });
      throw error;
    }
    await ctx.answerCallbackQuery();

    // Redraw the whole message from the database, so every button of an outdated message catches up.
    const items = await trackerService.getDayLog(ctx.from.id, trackerId, date);
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: trackerKeyboard(items, date) });
    } catch (error) {
      if (!isMessageNotModified(error)) throw error;
    }
  });
}
