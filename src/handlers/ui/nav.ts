import { InlineKeyboard } from 'grammy';

export const HOME_CALLBACK_DATA = 'home';
export const SETTINGS_CALLBACK_DATA = 'home:settings';

/** A "← Назад" button back to the home screen (see start.handler.ts's showHomeScreen). Shared by any mid-flow prompt that has no other way back. */
export function backToHomeButton(): ReturnType<typeof InlineKeyboard.text> {
  return InlineKeyboard.text('← Назад', HOME_CALLBACK_DATA);
}
