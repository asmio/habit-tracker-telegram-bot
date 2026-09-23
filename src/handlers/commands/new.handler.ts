import { Bot, InlineKeyboard, type Context } from 'grammy';
import { sessionService } from '../../services/session.service';
import { trackerService } from '../../services/tracker.service';
import { showScreen } from '../ui/screen';
import { deleteMessageSafely } from '../ui/telegram-errors';
import { backButton } from '../ui/tracker-picker';
import { showTrackersListScreen } from './trackers.handler';

const NAME_PROMPT = 'Как назвать новый трекер?';
const MAX_NAME_LENGTH = 64;

/**
 * The `callback_data` of the trackers list's button that opens the prompt. It doubles as the screen
 * route stored in the user's session, and that route *is* the "waiting for a name" state: a text
 * message is the tracker's name exactly while this is the session's screen, so the wait survives a
 * restart and ends by itself as soon as any other screen is shown.
 */
const NEW_TRACKER_SCREEN = 'trackers:new';

/** The prompt is only reachable from the trackers list, so that is where "← Назад" goes. */
const BACK_CALLBACK_DATA = 'trackers:list';

function promptKeyboard(): InlineKeyboard {
  return InlineKeyboard.from([[backButton(BACK_CALLBACK_DATA)]]);
}

/** Shows the flow's only prompt and starts waiting for the name. */
export async function startNewTrackerFlow(ctx: Context): Promise<void> {
  if (!ctx.from) return;
  await showScreen(ctx, ctx.from.id, NEW_TRACKER_SCREEN, NAME_PROMPT, promptKeyboard());
}

export function registerNewHandler(bot: Bot): void {
  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from) return next();
    const session = await sessionService.getSession(ctx.from.id);
    if (session?.screen !== NEW_TRACKER_SCREEN) return next();
    await deleteMessageSafely(ctx);

    const name = ctx.msg.text.trim();
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      const reason =
        name.length === 0
          ? 'Название не может быть пустым.'
          : `Слишком длинное название (максимум ${MAX_NAME_LENGTH} символов).`;
      // Same screen again, so the bot keeps waiting: let the user retry on the same message.
      await showScreen(ctx, ctx.from.id, NEW_TRACKER_SCREEN, `⚠️ ${reason}\n\n${NAME_PROMPT}`, promptKeyboard());
      return;
    }

    const user = await trackerService.getOrCreateUser(ctx.from.id);
    await trackerService.createTracker(user.telegramId, name);
    await showTrackersListScreen(ctx, ctx.from.id);
  });
}
