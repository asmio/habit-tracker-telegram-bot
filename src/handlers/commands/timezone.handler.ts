import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import {
  POPULAR_TIMEZONES,
  timezoneButtonLabel,
  timezoneFromLocation,
} from '../../services/timezone.service';
import { isValidTimezone, trackerService } from '../../services/tracker.service';
import { createPendingInput } from '../middleware/pending-input';
import { MAIN_MENU_KEYBOARD } from '../ui/keyboard';
import { EMPTY_KEYBOARD, rememberScreen, showScreen, type ScreenRef } from '../ui/screen';
import { deleteMessageSafely } from '../ui/telegram-errors';

const OTHER_PROMPT = 'Пришли название часового пояса в формате Регион/Город, например Asia/Almaty.';
const LOCATION_PROMPT = '📍 Отправь геолокацию кнопкой ниже.';
const CONFIRMATION_HINT =
  'Новый день начинается по этому поясу. Создай трекер: /new, сегодняшний день: /today. Сменить пояс: /timezone.';
export const DEFAULT_PROMPT = 'Выбери свой часовой пояс — от него зависит, когда для тебя начинается новый день.';
const LOCATION_TTL_MS = 5 * 60 * 1000;

const pendingOther = createPendingInput<ScreenRef>();

// A shared location arrives as a plain message, not as a reply, so unlike the other dialogs it
// cannot be tied to a prompt. This is the only in-memory state: who tapped "by location" recently.
// Losing it on restart just means the user taps the button again.
const awaitingLocation = new Map<number, number>();

function expectLocation(telegramId: number): void {
  const now = Date.now();
  for (const [id, expiresAt] of awaitingLocation) {
    if (expiresAt <= now) awaitingLocation.delete(id);
  }
  awaitingLocation.set(telegramId, now + LOCATION_TTL_MS);
}

function consumeLocationExpectation(telegramId: number): boolean {
  const expiresAt = awaitingLocation.get(telegramId);
  awaitingLocation.delete(telegramId);
  return expiresAt !== undefined && expiresAt > Date.now();
}

/** Saves the zone and reports whether the user had already confirmed one before this call. */
async function saveTimezone(telegramId: number, timezone: string): Promise<{ wasConfirmedBefore: boolean }> {
  const user = await trackerService.getOrCreateUser(telegramId);
  const wasConfirmedBefore = user.timezoneConfirmed;
  await trackerService.setTimezone(telegramId, timezone);
  return { wasConfirmedBefore };
}

/**
 * Finishes a zone confirmation. Changing an already-confirmed zone needs nothing beyond editing
 * the current screen: the persistent main menu is already showing. The very first confirmation
 * ever, though, needs one extra, unavoidably fresh message to attach `MAIN_MENU_KEYBOARD` for the
 * first time -- a `ReplyKeyboardMarkup` can only ever be attached by sending, never by editing.
 */
async function completeTimezoneConfirmation(
  ctx: Context,
  telegramId: number,
  timezone: string,
  wasConfirmedBefore: boolean,
): Promise<void> {
  const doneText = `Часовой пояс: ${timezone} ✅`;
  if (wasConfirmedBefore) {
    await showScreen(ctx, telegramId, `${doneText}\n${CONFIRMATION_HINT}`, EMPTY_KEYBOARD);
    return;
  }

  await showScreen(ctx, telegramId, doneText, EMPTY_KEYBOARD);
  const sent = await ctx.reply(CONFIRMATION_HINT, { reply_markup: MAIN_MENU_KEYBOARD });
  rememberScreen(telegramId, sent.chat.id, sent.message_id);
}

/** Sends the zone picker: popular zones, plus manual entry and location as fallbacks. */
export async function promptTimezone(ctx: Context, telegramId: number, text: string = DEFAULT_PROMPT): Promise<void> {
  type Button = ReturnType<typeof InlineKeyboard.text>;

  const now = new Date();
  const zones = POPULAR_TIMEZONES.map((tz) =>
    InlineKeyboard.text(timezoneButtonLabel(tz, now), `tz:${tz.zone}`),
  );
  const rows: Button[][] = [];
  for (let i = 0; i < zones.length; i += 2) {
    rows.push(zones.slice(i, i + 2));
  }
  rows.push([
    InlineKeyboard.text('🌍 Другой…', 'tz-other'),
    InlineKeyboard.text('📍 По геолокации', 'tz-location'),
  ]);

  await showScreen(ctx, telegramId, text, InlineKeyboard.from(rows));
}

/** Shows the zone picker, mentioning the current zone if one is already confirmed. Shared by /timezone and settings. */
export async function startTimezoneFlow(ctx: Context): Promise<void> {
  if (!ctx.from) return;

  const user = await trackerService.getOrCreateUser(ctx.from.id);
  await promptTimezone(
    ctx,
    ctx.from.id,
    user.timezoneConfirmed ? `Сейчас: ${user.timezone}. Выбери новый часовой пояс:` : DEFAULT_PROMPT,
  );
}

export function registerTimezoneHandler(bot: Bot): void {
  bot.command('timezone', startTimezoneFlow);

  bot.callbackQuery(/^tz:(.+)$/, async (ctx) => {
    const timezone = ctx.match[1];
    // Callback data is client-controlled: never trust it to be one of the zones we offered.
    if (!isValidTimezone(timezone)) {
      await ctx.answerCallbackQuery({ text: 'Неизвестный часовой пояс.' });
      return;
    }

    const { wasConfirmedBefore } = await saveTimezone(ctx.from.id, timezone);
    await ctx.answerCallbackQuery();
    await completeTimezoneConfirmation(ctx, ctx.from.id, timezone, wasConfirmedBefore);
  });

  bot.callbackQuery('tz-other', async (ctx) => {
    await ctx.answerCallbackQuery();
    const ref = await showScreen(ctx, ctx.from.id, OTHER_PROMPT, EMPTY_KEYBOARD);
    pendingOther.set(ctx.from.id, ref);
  });

  bot.callbackQuery('tz-location', async (ctx) => {
    await ctx.answerCallbackQuery();
    expectLocation(ctx.from.id);

    // Edits the picker away first, so its now-stale zone buttons stop being tappable, before the
    // unavoidably fresh send below (a `ReplyKeyboardMarkup` -- here, the location request -- can
    // never be attached by editing).
    await showScreen(ctx, ctx.from.id, LOCATION_PROMPT, EMPTY_KEYBOARD);
    const sent = await ctx.reply(
      'Нажми кнопку ниже, чтобы отправить геолокацию. Координаты не сохраняются: по ним я один раз определю часовой пояс.',
      { reply_markup: new Keyboard().requestLocation('📍 Отправить геолокацию').oneTime().resized() },
    );
    rememberScreen(ctx.from.id, sent.chat.id, sent.message_id);
  });

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from) return next();
    const state = pendingOther.consume(ctx.from.id);
    if (!state) return next();
    await deleteMessageSafely(ctx);

    const timezone = ctx.msg.text.trim();
    if (!isValidTimezone(timezone)) {
      // showScreen clears pending state first (see screen.ts), so re-arm it AFTER, not before.
      await showScreen(
        ctx,
        ctx.from.id,
        `⚠️ Не знаю такого пояса. Нужен формат Регион/Город, например Europe/Warsaw.\n\n${OTHER_PROMPT}`,
        EMPTY_KEYBOARD,
      );
      pendingOther.set(ctx.from.id, state); // keep waiting: let the user retry on the same message
      return;
    }

    const { wasConfirmedBefore } = await saveTimezone(ctx.from.id, timezone);
    await completeTimezoneConfirmation(ctx, ctx.from.id, timezone, wasConfirmedBefore);
  });

  bot.on('message:location', async (ctx) => {
    // Only a location the user was just asked for: any other one is just a place shared in the chat.
    if (!ctx.from || !consumeLocationExpectation(ctx.from.id)) return;

    const { latitude, longitude } = ctx.msg.location;
    const timezone = timezoneFromLocation(latitude, longitude);
    if (!timezone) {
      // The location-request keyboard is already gone the moment it was used; bring the
      // persistent main menu back instead of leaving the user with no reply keyboard at all.
      const sent = await ctx.reply('Не получилось определить часовой пояс по геолокации. Выбери из списка: /timezone', {
        reply_markup: MAIN_MENU_KEYBOARD,
      });
      rememberScreen(ctx.from.id, sent.chat.id, sent.message_id);
      return;
    }

    // The temporary location-request keyboard can only be swapped out by a fresh send, regardless
    // of whether the zone was already confirmed before -- unlike the other 2 paths, this one never
    // collapses to a single edit.
    await saveTimezone(ctx.from.id, timezone);
    const sent = await ctx.reply(`Часовой пояс: ${timezone} ✅\n${CONFIRMATION_HINT}`, {
      reply_markup: MAIN_MENU_KEYBOARD,
    });
    rememberScreen(ctx.from.id, sent.chat.id, sent.message_id);
  });
}
