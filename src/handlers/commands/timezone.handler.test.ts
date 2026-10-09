import { sessionService } from '../../services/session.service';
import { trackerService } from '../../services/tracker.service';
import {
  callbackUpdate,
  createAppBot,
  locationUpdate,
  resetDb,
  setupTestDb,
  textUpdate,
} from '../../testing/harness';

const UID = 1;

beforeAll(setupTestDb);
beforeEach(resetDb);

describe('tz:<zone> callback', () => {
  test('a valid, never-before-confirmed zone: clears the leftover reply keyboard, then lands on home', async () => {
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, 'tz:Europe/Minsk', { messageId: 10 }));

    expect(calls.map((c) => c.method)).toEqual([
      'answerCallbackQuery',
      'sendMessage', // the disposable "done" message, to clear any leftover ReplyKeyboardMarkup
      'deleteMessage', // ...and immediately delete it
      'editMessageText', // the tapped zone-picker message becomes the home screen
    ]);
    expect(calls[3].payload.message_id).toBe(10);
    expect(calls[3].payload.text).toMatch(/Часовой пояс: Europe\/Minsk ✅/);
    expect(calls[3].payload.text).toMatch(/Привет!/);

    const user = await trackerService.getOrCreateUser(UID);
    expect(user.timezone).toBe('Europe/Minsk');
    expect(user.timezoneConfirmed).toBe(true);

    const session = await sessionService.getSession(UID);
    expect(session).toMatchObject({ messageId: 10, screen: 'home' });
  });

  test('re-confirming an already-confirmed zone skips the disposable send entirely', async () => {
    await trackerService.getOrCreateUser(UID);
    await trackerService.setTimezone(UID, 'UTC');

    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, 'tz:Europe/Minsk', { messageId: 10 }));

    expect(calls.map((c) => c.method)).toEqual(['answerCallbackQuery', 'editMessageText']);
  });

  test('a zone not actually offered (spoofed callback_data) is rejected without saving anything', async () => {
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, 'tz:Not/AZone'));

    expect(calls).toEqual([{ method: 'answerCallbackQuery', payload: expect.objectContaining({ text: 'Неизвестный часовой пояс.' }) }]);
    const user = await trackerService.getOrCreateUser(UID);
    expect(user.timezoneConfirmed).toBe(false);
  });
});

test('tz-other opens the manual-entry prompt with no keyboard', async () => {
  const { bot, calls } = createAppBot();
  await bot.handleUpdate(callbackUpdate(UID, 'tz-other', { messageId: 10 }));

  const edit = calls.find((c) => c.method === 'editMessageText');
  expect((edit?.payload.reply_markup as { inline_keyboard: unknown[] }).inline_keyboard).toEqual([]);
  expect(await sessionService.getSession(UID)).toMatchObject({ screen: 'tz-other' });
});

describe('typed zone name (message:text while on tz-other)', () => {
  async function openOtherPrompt(bot: ReturnType<typeof createAppBot>['bot']) {
    await bot.handleUpdate(callbackUpdate(UID, 'tz-other', { messageId: 10 }));
  }

  test('a valid zone confirms it, same as tapping a popular-zone button', async () => {
    const { bot, calls } = createAppBot();
    await openOtherPrompt(bot);
    await bot.handleUpdate(textUpdate(UID, 'Asia/Almaty'));

    const user = await trackerService.getOrCreateUser(UID);
    expect(user.timezone).toBe('Asia/Almaty');
    expect(calls.some((c) => c.method === 'editMessageText' && (c.payload.text as string).includes('Asia/Almaty ✅'))).toBe(
      true,
    );
  });

  test('an unrecognised zone name re-prompts on the same tracked screen', async () => {
    const { bot, calls } = createAppBot();
    await openOtherPrompt(bot);
    await bot.handleUpdate(textUpdate(UID, 'not a zone'));

    const edit = calls.at(-1)!;
    expect(edit.method).toBe('editMessageText');
    expect(edit.payload.text).toMatch(/Не знаю такого пояса/);
    expect(await sessionService.getSession(UID)).toMatchObject({ screen: 'tz-other' });
  });

  test('typing text while not on the tz-other screen is ignored by this handler', async () => {
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(textUpdate(UID, 'Europe/Minsk'));
    expect(calls).toHaveLength(0);
  });
});

describe('location flow', () => {
  test('tz-location edits the picker into the location prompt, then sends a disposable request-location keyboard', async () => {
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, 'tz-location', { messageId: 10 }));

    expect(calls.map((c) => c.method)).toEqual(['answerCallbackQuery', 'editMessageText', 'sendMessage']);
    const edit = calls[1];
    expect(edit.payload.message_id).toBe(10);
    expect((edit.payload.reply_markup as { inline_keyboard: unknown[] }).inline_keyboard).toEqual([]);

    const locationRequest = calls[2];
    expect(locationRequest.payload.reply_markup).toMatchObject({ keyboard: expect.any(Array) });

    // The session still tracks the edited picker message, not the disposable location-request send.
    expect(await sessionService.getSession(UID)).toMatchObject({ messageId: 10, screen: 'tz-location' });
  });

  test('a resolvable location confirms that zone, same as tz:<zone>', async () => {
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, 'tz-location', { messageId: 10 }));
    await bot.handleUpdate(locationUpdate(UID, 53.9, 27.5667)); // Minsk

    const user = await trackerService.getOrCreateUser(UID);
    expect(user.timezone).toBe('Europe/Minsk');
    expect(
      calls.some((c) => c.method === 'editMessageText' && (c.payload.text as string).includes('Europe/Minsk ✅')),
    ).toBe(true);
  });

  test('coordinates that fail to resolve re-show the full picker with a failure note, not the raw prompt', async () => {
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(callbackUpdate(UID, 'tz-location', { messageId: 10 }));
    const before = calls.length;
    await bot.handleUpdate(locationUpdate(UID, 999, 999)); // out of range

    const after = calls.slice(before);
    expect(after.map((c) => c.method)).toEqual(['sendMessage', 'deleteMessage', 'editMessageText']);
    expect(after[2].payload.text).toMatch(/Не получилось определить часовой пояс/);
    expect(after[2].payload.message_id).toBe(10);
    expect(await sessionService.getSession(UID)).toMatchObject({ screen: 'settings:timezone' });
  });

  test('a location shared outside the tz-location screen is just ignored', async () => {
    const { bot, calls } = createAppBot();
    await bot.handleUpdate(locationUpdate(UID, 53.9, 27.5667));
    expect(calls).toHaveLength(0);
  });
});
