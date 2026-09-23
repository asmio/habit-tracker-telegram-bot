import { InlineKeyboard, type Context } from 'grammy';
import { backToHomeButton } from '../ui/nav';
import { showScreen } from '../ui/screen';

const SETTINGS_TEXT = '⚙️ Настройки';

// TODO: a "🔔 Напоминания" row joins this once daily reminders exist.
function settingsKeyboard(): InlineKeyboard {
  return InlineKeyboard.from([[InlineKeyboard.text('🌍 Часовой пояс', 'settings:timezone')], [backToHomeButton()]]);
}

/**
 * Renders the settings screen. Shared by the home screen's "⚙️ Настройки" button and (later) any
 * other entry point. This file has no `register*Handler` of its own -- its `settings:timezone`
 * callback is wired in menu.handler.ts, alongside `home:*`, to avoid a circular import with
 * start.handler.ts (settings needs `showHomeScreen` for "← Назад"; the home screen needs this
 * screen for its button). "← Назад" itself is the shared `HOME_CALLBACK_DATA` (see ui/nav.ts).
 */
export async function showSettingsScreen(ctx: Context, telegramId: number): Promise<void> {
  await showScreen(ctx, telegramId, SETTINGS_TEXT, settingsKeyboard());
}
