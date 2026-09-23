import { Bot, InlineKeyboard, type Context } from 'grammy';
import { trackerService } from '../../services/tracker.service';
import { createPendingInput } from '../middleware/pending-input';
import { HOME_CALLBACK_DATA } from '../ui/nav';
import { showScreen, type ScreenRef } from '../ui/screen';
import { deleteMessageSafely } from '../ui/telegram-errors';
import { backButton } from '../ui/tracker-picker';
import { showTrackersListScreen } from './trackers.handler';

const NAME_PROMPT = 'Как назвать новый трекер?';
const MAX_NAME_LENGTH = 64;

interface PendingNewTracker extends ScreenRef {
  backCallbackData: string;
}

const pending = createPendingInput<PendingNewTracker>();

/**
 * Sends the flow's only prompt. Shared by /new, the "➕ Новый трекер" menu button, the quick-nav
 * row and the trackers list -- each leads back somewhere different (home, the trackers list, ...),
 * so `backCallbackData` carries where "← Назад" should go; it defaults to home for callers that
 * have no more specific screen to return to.
 */
export async function startNewTrackerFlow(ctx: Context, backCallbackData: string = HOME_CALLBACK_DATA): Promise<void> {
  if (!ctx.from) return;
  const ref = await showScreen(ctx, ctx.from.id, NAME_PROMPT, InlineKeyboard.from([[backButton(backCallbackData)]]));
  pending.set(ctx.from.id, { ...ref, backCallbackData });
}

export function registerNewHandler(bot: Bot): void {
  bot.command('new', (ctx) => startNewTrackerFlow(ctx));

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from) return next();
    const state = pending.consume(ctx.from.id);
    if (!state) return next();
    await deleteMessageSafely(ctx);

    const name = ctx.msg.text.trim();
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      const reason =
        name.length === 0
          ? 'Название не может быть пустым.'
          : `Слишком длинное название (максимум ${MAX_NAME_LENGTH} символов).`;
      // showScreen clears pending state first (see screen.ts), so re-arm it AFTER, not before.
      await showScreen(
        ctx,
        ctx.from.id,
        `⚠️ ${reason}\n\n${NAME_PROMPT}`,
        InlineKeyboard.from([[backButton(state.backCallbackData)]]),
      );
      pending.set(ctx.from.id, state); // keep waiting: let the user retry on the same message
      return;
    }

    const user = await trackerService.getOrCreateUser(ctx.from.id);
    await trackerService.createTracker(user.telegramId, name);
    await showTrackersListScreen(ctx, ctx.from.id);
  });
}
