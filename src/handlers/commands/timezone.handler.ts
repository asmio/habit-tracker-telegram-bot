import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import {
  POPULAR_TIMEZONES,
  timezoneButtonLabel,
  timezoneFromLocation,
} from '../../services/timezone.service';
import { sessionService } from '../../services/session.service';
import { isValidTimezone, trackerService } from '../../services/tracker.service';
import { EMPTY_KEYBOARD, showScreen } from '../ui/screen';
import { deleteMessageSafely } from '../ui/telegram-errors';
import { showHomeScreen } from './start.handler';

const OTHER_PROMPT = 'Пришли название часового пояса в формате Регион/Город, например Asia/Almaty.';
const LOCATION_PROMPT = '📍 Отправь геолокацию кнопкой ниже.';
export const DEFAULT_PROMPT = 'Выбери свой часовой пояс — от него зависит, когда для тебя начинается новый день.';

/**
 * The two prompts of this file wait for input, and (like new.handler.ts) the wait *is* the route
 * stored in the user's session: typed text is a time zone name exactly while `TZ_OTHER_SCREEN` is
 * the session's screen, and a shared location is taken exactly while `TZ_LOCATION_SCREEN` is.
 * So neither wait is lost by a restart, and showing any other screen ends it by itself. Any other
 * location a user shares is just a place shared in the chat and is ignored.
 */
const TZ_OTHER_SCREEN = 'tz-other';
const TZ_LOCATION_SCREEN = 'tz-location';

/**
 * A message sent with a `ReplyKeyboardMarkup`-family `reply_markup` (`remove_keyboard` included)
 * can never later have an `InlineKeyboardMarkup` attached via edit -- Telegram rejects it with
 * "400: Bad Request: message can't be edited". Such a send is therefore always disposable: it
 * exists only to clear a leftover reply keyboard, never becomes the tracked screen, and is deleted
 * right after -- best-effort, a lingering throwaway is harmless if deletion fails.
 */
async function sendDisposable(ctx: Context, text: string): Promise<void> {
  const sent = await ctx.reply(text, { reply_markup: { remove_keyboard: true } });
  try {
    await ctx.api.deleteMessage(sent.chat.id, sent.message_id);
  } catch {
    // Best-effort.
  }
}

/** Saves the zone and reports whether the user had already confirmed one before this call. */
async function saveTimezone(telegramId: number, timezone: string): Promise<{ wasConfirmedBefore: boolean }> {
  const user = await trackerService.getOrCreateUser(telegramId);
  const wasConfirmedBefore = user.timezoneConfirmed;
  await trackerService.setTimezone(telegramId, timezone);
  return { wasConfirmedBefore };
}

/**
 * Finishes a zone confirmation by landing on the home screen -- always via editing whatever screen
 * is currently tracked (the zone picker, still an `InlineKeyboardMarkup` message no matter which of
 * the 3 confirmation paths got here), never via the disposable reply-keyboard-clearing send.
 */
async function completeTimezoneConfirmation(
  ctx: Context,
  telegramId: number,
  timezone: string,
  wasConfirmedBefore: boolean,
): Promise<void> {
  const doneText = `Часовой пояс: ${timezone} ✅`;
  if (!wasConfirmedBefore) {
    // Only ever needed once per account: clears a leftover `ReplyKeyboardMarkup` from a now-retired
    // feature (harmless to run for an account that never had one, since there's no way to tell the
    // two apart).
    await sendDisposable(ctx, doneText);
  }
  await showHomeScreen(ctx, telegramId, doneText);
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

  await showScreen(ctx, telegramId, 'settings:timezone', text, InlineKeyboard.from(rows));
}

/** Shows the zone picker, mentioning the current zone if one is already confirmed. Shared by the timezone gate and settings. */
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
    await showScreen(ctx, ctx.from.id, TZ_OTHER_SCREEN, OTHER_PROMPT, EMPTY_KEYBOARD);
  });

  bot.callbackQuery('tz-location', async (ctx) => {
    await ctx.answerCallbackQuery();

    // Edits the picker away first, so its now-stale zone buttons stop being tappable, before the
    // unavoidably fresh send below (a `ReplyKeyboardMarkup` -- here, the location request -- can
    // never be attached by editing, so it's deliberately not tracked as the screen either: the
    // edited picker above stays the session's screen, ready for message:location's handler below to edit next).
    await showScreen(ctx, ctx.from.id, TZ_LOCATION_SCREEN, LOCATION_PROMPT, EMPTY_KEYBOARD);
    await ctx.reply(
      'Нажми кнопку ниже, чтобы отправить геолокацию. Координаты не сохраняются: по ним я один раз определю часовой пояс.',
      { reply_markup: new Keyboard().requestLocation('📍 Отправить геолокацию').oneTime().resized() },
    );
  });

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from) return next();
    const session = await sessionService.getSession(ctx.from.id);
    if (session?.screen !== TZ_OTHER_SCREEN) return next();
    await deleteMessageSafely(ctx);

    const timezone = ctx.msg.text.trim();
    if (!isValidTimezone(timezone)) {
      // Same screen again, so the bot keeps waiting: let the user retry on the same message.
      await showScreen(
        ctx,
        ctx.from.id,
        TZ_OTHER_SCREEN,
        `⚠️ Не знаю такого пояса. Нужен формат Регион/Город, например Europe/Warsaw.\n\n${OTHER_PROMPT}`,
        EMPTY_KEYBOARD,
      );
      return;
    }

    const { wasConfirmedBefore } = await saveTimezone(ctx.from.id, timezone);
    await completeTimezoneConfirmation(ctx, ctx.from.id, timezone, wasConfirmedBefore);
  });

  bot.on('message:location', async (ctx) => {
    if (!ctx.from) return;
    const session = await sessionService.getSession(ctx.from.id);
    if (session?.screen !== TZ_LOCATION_SCREEN) return;

    const { latitude, longitude } = ctx.msg.location;
    const timezone = timezoneFromLocation(latitude, longitude);
    if (!timezone) {
      // The location-request keyboard is already gone the moment it was used; explicitly clear it
      // via a disposable send, then edit the still-tracked picker (from tz-location above) into the
      // retry prompt so the user can just try again from there.
      const failText = 'Не получилось определить часовой пояс по геолокации.';
      await sendDisposable(ctx, failText);
      await promptTimezone(ctx, ctx.from.id, `${failText}\n\n${DEFAULT_PROMPT}`);
      return;
    }

    // Same disposable-then-edit-the-tracked-picker pattern as the failure branch above and as
    // `completeTimezoneConfirmation`'s first-ever-confirmation path.
    await saveTimezone(ctx.from.id, timezone);
    const doneText = `Часовой пояс: ${timezone} ✅`;
    await sendDisposable(ctx, doneText);
    await showHomeScreen(ctx, ctx.from.id, doneText);
  });
}
