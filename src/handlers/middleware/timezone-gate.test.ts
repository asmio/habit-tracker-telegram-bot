import { Bot } from 'grammy';
import { trackerService } from '../../services/tracker.service';
import {
  callbackUpdate,
  commandUpdate,
  FAKE_BOT_INFO,
  recordApiCalls,
  resetDb,
  setupTestDb,
} from '../../testing/harness';
import { registerTimezoneGate } from './timezone-gate';

const UID = 1;

beforeAll(setupTestDb);
beforeEach(resetDb);

function testBot() {
  const bot = new Bot('test-token', { botInfo: FAKE_BOT_INFO });
  registerTimezoneGate(bot);
  const state = { reachedDownstream: false };
  bot.use((_ctx, next) => {
    state.reachedDownstream = true;
    return next();
  });
  const calls = recordApiCalls(bot);
  return { bot, calls, state };
}

test('a command from a user with no confirmed zone is blocked, and shown the zone picker instead', async () => {
  const { bot, calls, state } = testBot();
  await bot.handleUpdate(commandUpdate(UID, '/menu'));

  expect(state.reachedDownstream).toBe(false);
  expect(calls.some((c) => c.method === 'sendMessage' || c.method === 'editMessageText')).toBe(true);

  const user = await trackerService.getOrCreateUser(UID);
  expect(user.timezoneConfirmed).toBe(false); // the gate only prompts, it never confirms one itself
});

test('a callback query from an unconfirmed user is blocked, answered with a hint, and shown the picker', async () => {
  const { bot, calls, state } = testBot();
  await bot.handleUpdate(callbackUpdate(UID, 'anything'));

  expect(state.reachedDownstream).toBe(false);
  const answer = calls.find((c) => c.method === 'answerCallbackQuery');
  expect(answer?.payload.text).toBe('Сначала выбери часовой пояс.');
  expect(calls.some((c) => c.method === 'sendMessage' || c.method === 'editMessageText')).toBe(true);
});

test('a confirmed user passes straight through to the next handler', async () => {
  await trackerService.getOrCreateUser(UID);
  await trackerService.setTimezone(UID, 'Europe/Minsk');

  const { bot, calls, state } = testBot();
  await bot.handleUpdate(commandUpdate(UID, '/menu'));

  expect(state.reachedDownstream).toBe(true);
  expect(calls).toHaveLength(0); // the gate itself did nothing
});

test('messages that are neither a command nor a callback query are never gated', async () => {
  const { bot, state } = testBot();
  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: UID, type: 'private' },
      from: { id: UID, is_bot: false, first_name: 'Test User' },
      text: 'just a plain message, not a command',
    },
  } as never);

  expect(state.reachedDownstream).toBe(true);
});
