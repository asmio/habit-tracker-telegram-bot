import { Bot, InlineKeyboard, type Context } from 'grammy';
import { logger } from '../../logger';
import { NotFoundError } from '../../services/errors';
import { trackerService } from '../../services/tracker.service';
import type { Tracker, TrackerItem } from '../../db/schema';
import { createPendingInput } from '../middleware/pending-input';
import { HOME_CALLBACK_DATA } from '../ui/nav';
import { showScreen, type ScreenRef } from '../ui/screen';
import { deleteMessageSafely, isMessageNotModified } from '../ui/telegram-errors';
import { backButton, confirmKeyboard } from '../ui/tracker-picker';

const MAX_LENGTH = 64;
const NO_TRACKERS_TEXT = 'Трекеров пока нет.';

/** The middle "N. Label" button in sort mode is a read-only position marker, not a control. */
const SORT_LABEL_CALLBACK_DATA = 'trackers:sort-label';
const SORT_MOVE_PATTERN = /^trackers:sortmove:(\d+):(up|down)$/;

type PendingTrackersInput = ScreenRef &
  (
    | { kind: 'rename-tracker'; trackerId: number; trackerName: string }
    | { kind: 'rename-item'; itemId: number; trackerId: number; label: string }
    | { kind: 'add-item'; trackerId: number; trackerName: string }
  );

const pending = createPendingInput<PendingTrackersInput>();

type Button = ReturnType<typeof InlineKeyboard.text>;

function renameText(name: string): string {
  return `Введи новое название для «${name}»:`;
}

function addItemText(trackerName: string): string {
  return `Введи название нового пункта для трекера «${trackerName}»:`;
}

/** The trackers list screen. Shared by the home screen's "🗂 Трекеры" button and every "← Назад" that leads back to it. */
export async function showTrackersListScreen(ctx: Context, telegramId: number, prefix?: string): Promise<void> {
  const trackerList = await trackerService.getTrackers(telegramId);
  const text = trackerList.length === 0 ? NO_TRACKERS_TEXT : '🗂 Твои трекеры:';

  const rows: Button[][] = trackerList.map((tracker) => [InlineKeyboard.text(tracker.name, `trackers:open:${tracker.id}`)]);
  rows.push([InlineKeyboard.text('➕ Новый трекер', 'trackers:new')]);
  rows.push([backButton(HOME_CALLBACK_DATA)]);

  await showScreen(ctx, telegramId, prefix ? `${prefix}\n\n${text}` : text, InlineKeyboard.from(rows));
}

async function showTrackerScreen(ctx: Context, telegramId: number, trackerId: number, prefix?: string): Promise<void> {
  const tracker = await trackerService.getTracker(telegramId, trackerId);
  const items = await trackerService.getItems(telegramId, trackerId);
  const text = `📋 ${tracker.name}` + (items.length === 0 ? '\n\nПунктов пока нет.' : '');

  const rows: Button[][] = items.map((item) => [InlineKeyboard.text(item.label, `trackers:item:${item.id}`)]);
  rows.push([InlineKeyboard.text('➕ Добавить пункт', `trackers:additem:${tracker.id}`)]);
  rows.push([InlineKeyboard.text('🔀 Изменить порядок', `trackers:sort:${tracker.id}`)]);
  rows.push([
    InlineKeyboard.text('✏️ Переименовать', `trackers:renametracker:${tracker.id}`),
    InlineKeyboard.text('🗑 Удалить', `trackers:deltracker:${tracker.id}`),
  ]);
  rows.push([backButton('trackers:list'), InlineKeyboard.text('🏠 Домой', HOME_CALLBACK_DATA)]);

  await showScreen(ctx, telegramId, prefix ? `${prefix}\n\n${text}` : text, InlineKeyboard.from(rows));
}

function sortKeyboard(trackerId: number, items: TrackerItem[]): InlineKeyboard {
  const rows: Button[][] = items.map((item, index) => [
    InlineKeyboard.text(`${index + 1}. ${item.label}`, SORT_LABEL_CALLBACK_DATA),
    InlineKeyboard.text('⬇️', `trackers:sortmove:${item.id}:down`),
  ]);
  rows.push([InlineKeyboard.text('✅ Готово', `trackers:open:${trackerId}`)]);
  return InlineKeyboard.from(rows);
}

async function showTrackerSortScreen(ctx: Context, telegramId: number, trackerId: number): Promise<void> {
  const tracker = await trackerService.getTracker(telegramId, trackerId);
  const items = await trackerService.getItems(telegramId, trackerId);
  const text = `📋 ${tracker.name}` + (items.length === 0 ? '\n\nПунктов пока нет.' : '');
  await showScreen(ctx, telegramId, text, sortKeyboard(tracker.id, items));
}

async function showItemScreen(ctx: Context, telegramId: number, itemId: number): Promise<void> {
  const item = await trackerService.getItem(telegramId, itemId);
  const rows: Button[][] = [
    [
      InlineKeyboard.text('✏️ Переименовать', `trackers:renameitem:${item.id}`),
      InlineKeyboard.text('🗑 Удалить', `trackers:delitem:${item.id}`),
    ],
    [backButton(`trackers:open:${item.trackerId}`), InlineKeyboard.text('🏠 Домой', HOME_CALLBACK_DATA)],
  ];
  await showScreen(ctx, telegramId, `📝 ${item.label}`, InlineKeyboard.from(rows));
}

export function registerTrackersHandler(bot: Bot): void {
  bot.callbackQuery('trackers:list', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    await showTrackersListScreen(ctx, ctx.from.id);
  });

  bot.callbackQuery(/^trackers:open:(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    try {
      await showTrackerScreen(ctx, ctx.from.id, trackerId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Tracker screen request for a tracker the user does not own', { telegramId: ctx.from.id, trackerId });
      await showTrackersListScreen(ctx, ctx.from.id, '⚠️ Трекер не найден.');
    }
  });

  bot.callbackQuery(/^trackers:sort:(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    try {
      await showTrackerSortScreen(ctx, ctx.from.id, trackerId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Sort screen request for a tracker the user does not own', { telegramId: ctx.from.id, trackerId });
      await showTrackersListScreen(ctx, ctx.from.id, '⚠️ Трекер не найден.');
    }
  });

  bot.callbackQuery(SORT_LABEL_CALLBACK_DATA, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(SORT_MOVE_PATTERN, async (ctx) => {
    const itemId = Number(ctx.match[1]);
    const direction = ctx.match[2] as 'up' | 'down';

    let trackerId: number;
    try {
      ({ trackerId } = await trackerService.moveItem(ctx.from.id, itemId, direction, { circular: true }));
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Sort move for an item the user does not own', { telegramId: ctx.from.id, itemId });
      await ctx.answerCallbackQuery({ text: 'Пункт не найден.' });
      return;
    }
    await ctx.answerCallbackQuery();

    // Redraw the whole keyboard from the database: a no-op move (already at the edge) needs no
    // update, and every other tap needs the swapped positions and renumbered labels reflected.
    const items = await trackerService.getItems(ctx.from.id, trackerId);
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: sortKeyboard(trackerId, items) });
    } catch (error) {
      if (!isMessageNotModified(error)) throw error;
    }
  });

  bot.callbackQuery(/^trackers:item:(\d+)$/, async (ctx) => {
    const itemId = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    try {
      await showItemScreen(ctx, ctx.from.id, itemId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Item screen request for an item the user does not own', { telegramId: ctx.from.id, itemId });
      await showTrackersListScreen(ctx, ctx.from.id, '⚠️ Пункт не найден.');
    }
  });

  bot.callbackQuery(/^trackers:renametracker:(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);

    let tracker: Tracker;
    try {
      tracker = await trackerService.getTracker(ctx.from.id, trackerId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Rename-tracker request for a tracker the user does not own', { telegramId: ctx.from.id, trackerId });
      await ctx.answerCallbackQuery({ text: 'Трекер не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    const ref = await showScreen(ctx, ctx.from.id, renameText(tracker.name), InlineKeyboard.from([[backButton(`trackers:open:${tracker.id}`)]]));
    pending.set(ctx.from.id, { ...ref, kind: 'rename-tracker', trackerId: tracker.id, trackerName: tracker.name });
  });

  bot.callbackQuery(/^trackers:additem:(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);

    let tracker: Tracker;
    try {
      tracker = await trackerService.getTracker(ctx.from.id, trackerId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Add-item request for a tracker the user does not own', { telegramId: ctx.from.id, trackerId });
      await ctx.answerCallbackQuery({ text: 'Трекер не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    const ref = await showScreen(ctx, ctx.from.id, addItemText(tracker.name), InlineKeyboard.from([[backButton(`trackers:open:${tracker.id}`)]]));
    pending.set(ctx.from.id, { ...ref, kind: 'add-item', trackerId: tracker.id, trackerName: tracker.name });
  });

  bot.callbackQuery(/^trackers:renameitem:(\d+)$/, async (ctx) => {
    const itemId = Number(ctx.match[1]);

    let item: TrackerItem;
    try {
      item = await trackerService.getItem(ctx.from.id, itemId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Rename-item request for an item the user does not own', { telegramId: ctx.from.id, itemId });
      await ctx.answerCallbackQuery({ text: 'Пункт не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    const ref = await showScreen(ctx, ctx.from.id, renameText(item.label), InlineKeyboard.from([[backButton(`trackers:item:${item.id}`)]]));
    pending.set(ctx.from.id, { ...ref, kind: 'rename-item', itemId: item.id, trackerId: item.trackerId, label: item.label });
  });

  bot.callbackQuery(/^trackers:deltracker:(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);

    let tracker: Tracker;
    try {
      tracker = await trackerService.getTracker(ctx.from.id, trackerId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Delete-tracker request for a tracker the user does not own', { telegramId: ctx.from.id, trackerId });
      await ctx.answerCallbackQuery({ text: 'Трекер не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    await showScreen(
      ctx,
      ctx.from.id,
      `Удалить «${tracker.name}» вместе со всеми пунктами и историей?`,
      confirmKeyboard('🗑 Да, удалить', `trackers:deltrackerconfirm:${tracker.id}`, `trackers:open:${tracker.id}`),
    );
  });

  bot.callbackQuery(/^trackers:deltrackerconfirm:(\d+)$/, async (ctx) => {
    const trackerId = Number(ctx.match[1]);

    let tracker: Tracker;
    try {
      tracker = await trackerService.deleteTracker(ctx.from.id, trackerId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Delete-tracker confirm for a tracker the user does not own', { telegramId: ctx.from.id, trackerId });
      await ctx.answerCallbackQuery({ text: 'Трекер не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    await showTrackersListScreen(ctx, ctx.from.id, `✅ Трекер «${tracker.name}» удалён.`);
  });

  bot.callbackQuery(/^trackers:delitem:(\d+)$/, async (ctx) => {
    const itemId = Number(ctx.match[1]);

    let item: TrackerItem;
    try {
      item = await trackerService.getItem(ctx.from.id, itemId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Delete-item request for an item the user does not own', { telegramId: ctx.from.id, itemId });
      await ctx.answerCallbackQuery({ text: 'Пункт не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    await showScreen(
      ctx,
      ctx.from.id,
      `Удалить «${item.label}»?`,
      confirmKeyboard('🗑 Да', `trackers:delitemconfirm:${item.id}`, `trackers:item:${item.id}`),
    );
  });

  bot.callbackQuery(/^trackers:delitemconfirm:(\d+)$/, async (ctx) => {
    const itemId = Number(ctx.match[1]);

    let item: TrackerItem;
    try {
      item = await trackerService.deleteItem(ctx.from.id, itemId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      logger.warn('Delete-item confirm for an item the user does not own', { telegramId: ctx.from.id, itemId });
      await ctx.answerCallbackQuery({ text: 'Пункт не найден.' });
      return;
    }

    await ctx.answerCallbackQuery();
    await showTrackerScreen(ctx, ctx.from.id, item.trackerId, `✅ Пункт «${item.label}» удалён.`);
  });

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from) return next();
    const state = pending.consume(ctx.from.id);
    if (!state) return next();
    await deleteMessageSafely(ctx);

    const text = ctx.msg.text.trim();
    if (text.length === 0 || text.length > MAX_LENGTH) {
      const reason = text.length === 0 ? 'Название не может быть пустым.' : `Слишком длинное название (максимум ${MAX_LENGTH} символов).`;
      const promptText =
        state.kind === 'rename-tracker'
          ? renameText(state.trackerName)
          : state.kind === 'rename-item'
            ? renameText(state.label)
            : addItemText(state.trackerName);
      const backCallbackData =
        state.kind === 'rename-item' ? `trackers:item:${state.itemId}` : `trackers:open:${state.trackerId}`;

      // showScreen clears pending state first (see screen.ts), so re-arm it AFTER, not before.
      await showScreen(ctx, ctx.from.id, `⚠️ ${reason}\n\n${promptText}`, InlineKeyboard.from([[backButton(backCallbackData)]]));
      pending.set(ctx.from.id, state); // keep waiting: let the user retry on the same message
      return;
    }

    try {
      if (state.kind === 'rename-tracker') {
        await trackerService.updateTrackerName(ctx.from.id, state.trackerId, text);
        await showTrackerScreen(ctx, ctx.from.id, state.trackerId);
      } else if (state.kind === 'rename-item') {
        await trackerService.updateItemLabel(ctx.from.id, state.itemId, text);
        await showTrackerScreen(ctx, ctx.from.id, state.trackerId);
      } else {
        await trackerService.createItem(ctx.from.id, state.trackerId, text);
        await showTrackerScreen(ctx, ctx.from.id, state.trackerId);
      }
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      await showTrackersListScreen(ctx, ctx.from.id, '⚠️ Трекер не найден.');
    }
  });
}
