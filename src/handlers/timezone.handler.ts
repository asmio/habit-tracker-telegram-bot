import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import {
  POPULAR_TIMEZONES,
  timezoneButtonLabel,
  timezoneFromLocation,
} from '../services/timezone.service';
import { isValidTimezone, trackerService } from '../services/tracker.service';
import { getBotPromptText } from './prompt';
import { isMessageNotModified } from './telegram-errors';

const OTHER_PROMPT =
  'Пришли название часового пояса в формате Регион/Город, например Asia/Almaty. Ответь на это сообщение.';
const CONFIRMATION_HINT =
  'Новый день начинается по этому поясу. Создай трекер: /new, сегодняшний день: /today. Сменить пояс: /timezone.';
const DEFAULT_PROMPT = 'Выбери свой часовой пояс — от него зависит, когда для тебя начинается новый день.';
const LOCATION_TTL_MS = 5 * 60 * 1000;

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

async function saveTimezone(telegramId: number, timezone: string): Promise<void> {
  await trackerService.getOrCreateUser(telegramId);
  await trackerService.setTimezone(telegramId, timezone);
}

/** Sends the zone picker: popular zones, plus manual entry and location as fallbacks. */
export async function promptTimezone(ctx: Context, text: string = DEFAULT_PROMPT): Promise<void> {
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

  await ctx.reply(text, { reply_markup: InlineKeyboard.from(rows) });
}

export function registerTimezoneHandler(bot: Bot): void {
  bot.command('timezone', async (ctx) => {
    if (!ctx.from) return;

    const user = await trackerService.getOrCreateUser(ctx.from.id);
    await promptTimezone(
      ctx,
      user.timezoneConfirmed ? `Сейчас: ${user.timezone}. Выбери новый часовой пояс:` : DEFAULT_PROMPT,
    );
  });

  bot.callbackQuery(/^tz:(.+)$/, async (ctx) => {
    const timezone = ctx.match[1];
    // Callback data is client-controlled: never trust it to be one of the zones we offered.
    if (!isValidTimezone(timezone)) {
      await ctx.answerCallbackQuery({ text: 'Неизвестный часовой пояс.' });
      return;
    }

    await saveTimezone(ctx.from.id, timezone);
    await ctx.answerCallbackQuery();

    try {
      // Editing the text without a keyboard also removes the picker.
      await ctx.editMessageText(`Часовой пояс: ${timezone} ✅`);
    } catch (error) {
      // Same zone tapped twice: the message is already confirmed, nothing more to say.
      if (isMessageNotModified(error)) return;
      throw error;
    }
    await ctx.reply(CONFIRMATION_HINT);
  });

  bot.callbackQuery('tz-other', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(OTHER_PROMPT, {
      reply_markup: { force_reply: true, input_field_placeholder: 'Asia/Almaty' },
    });
  });

  bot.callbackQuery('tz-location', async (ctx) => {
    await ctx.answerCallbackQuery();
    expectLocation(ctx.from.id);
    await ctx.reply(
      'Нажми кнопку ниже, чтобы отправить геолокацию. Координаты не сохраняются: по ним я один раз определю часовой пояс.',
      { reply_markup: new Keyboard().requestLocation('📍 Отправить геолокацию').oneTime().resized() },
    );
  });

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from || getBotPromptText(ctx) !== OTHER_PROMPT) return next();

    const timezone = ctx.msg.text.trim();
    if (!isValidTimezone(timezone)) {
      await ctx.reply('Не знаю такого пояса. Нужен формат Регион/Город, например Europe/Warsaw. Попробуй ещё раз: /timezone');
      return;
    }

    await saveTimezone(ctx.from.id, timezone);
    await ctx.reply(`Часовой пояс: ${timezone} ✅\n${CONFIRMATION_HINT}`);
  });

  bot.on('message:location', async (ctx) => {
    // Only a location the user was just asked for: any other one is just a place shared in the chat.
    if (!ctx.from || !consumeLocationExpectation(ctx.from.id)) return;

    const { latitude, longitude } = ctx.msg.location;
    const timezone = timezoneFromLocation(latitude, longitude);
    if (!timezone) {
      await ctx.reply('Не получилось определить часовой пояс по геолокации. Выбери из списка: /timezone', {
        reply_markup: { remove_keyboard: true },
      });
      return;
    }

    await saveTimezone(ctx.from.id, timezone);
    await ctx.reply(`Часовой пояс: ${timezone} ✅\n${CONFIRMATION_HINT}`, {
      reply_markup: { remove_keyboard: true },
    });
  });
}
