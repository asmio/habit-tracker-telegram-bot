import { InlineKeyboard } from 'grammy';

const BACK_LABEL = '← Назад';

type Button = ReturnType<typeof InlineKeyboard.text>;

export function backButton(callbackData: string): Button {
  return InlineKeyboard.text(BACK_LABEL, callbackData);
}

export function confirmKeyboard(confirmLabel: string, confirmCallbackData: string, backCallbackData?: string): InlineKeyboard {
  const row: Button[] = [InlineKeyboard.text(confirmLabel, confirmCallbackData)];
  if (backCallbackData) row.push(backButton(backCallbackData));
  return InlineKeyboard.from([row]);
}
