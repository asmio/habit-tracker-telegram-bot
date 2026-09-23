import { Bot, InlineKeyboard, type Context } from 'grammy';
import { sessionService } from '../../services/session.service';
import { trackerService } from '../../services/tracker.service';
import { HOME_CALLBACK_DATA, SETTINGS_CALLBACK_DATA } from '../ui/nav';
import { showScreen } from '../ui/screen';
import { DEFAULT_PROMPT, promptTimezone } from './timezone.handler';

const GREETING = 'Привет! Я помогу отслеживать твои привычки.';

function homeKeyboard(): InlineKeyboard {
  return InlineKeyboard.from([
    [InlineKeyboard.text('🏠 Сегодняшний день', 'home:today')],
    [InlineKeyboard.text('🗂 Трекеры', 'home:trackers')],
    [InlineKeyboard.text('⚙️ Настройки', SETTINGS_CALLBACK_DATA)],
  ]);
}

/** Renders the home screen: greeting + the 3 primary actions. Shared by /start, the `home:*` buttons and timezone confirmation. */
export async function showHomeScreen(ctx: Context, telegramId: number, prefix?: string): Promise<void> {
  const text = prefix ? `${prefix}\n\n${GREETING}` : GREETING;
  await showScreen(ctx, telegramId, HOME_CALLBACK_DATA, text, homeKeyboard());
}

export function registerStartHandler(bot: Bot): void {
  bot.command('start', async (ctx) => {
    if (!ctx.from) return;

    // /start always opens a fresh screen right under the command the user just typed, instead of
    // editing an old message somewhere far up the chat (where they would see no visible change).
    await sessionService.clearSession(ctx.from.id);

    const user = await trackerService.getOrCreateUser(ctx.from.id);
    if (!user.timezoneConfirmed) {
      // One message: greeting + zone picker.
      await promptTimezone(ctx, ctx.from.id, `${GREETING}\n\n${DEFAULT_PROMPT}`);
      return;
    }

    await showHomeScreen(ctx, ctx.from.id);
  });
}
