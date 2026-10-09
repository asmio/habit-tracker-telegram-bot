import { sessionService } from '../../services/session.service';
import { trackerService } from '../../services/tracker.service';
import { commandUpdate, createAppBot, resetDb, setupTestDb } from '../../testing/harness';

const UID = 1;

beforeAll(setupTestDb);
beforeEach(resetDb);

test('/start for a brand new user greets them and opens the time zone picker, not the home screen', async () => {
  const { bot, calls } = createAppBot();
  await bot.handleUpdate(commandUpdate(UID, '/start'));

  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('sendMessage');
  expect(calls[0].payload.text).toMatch(/Привет! Я помогу отслеживать твои привычки\./);
  expect(calls[0].payload.text).toMatch(/часовой пояс/);

  const session = await sessionService.getSession(UID);
  expect(session).toMatchObject({ screen: 'settings:timezone' });

  const user = await trackerService.getOrCreateUser(UID);
  expect(user.timezoneConfirmed).toBe(false);
});

test('/start for an already-confirmed user opens the home screen', async () => {
  await trackerService.getOrCreateUser(UID);
  await trackerService.setTimezone(UID, 'Europe/Minsk');

  const { bot, calls } = createAppBot();
  await bot.handleUpdate(commandUpdate(UID, '/start'));

  expect(calls).toHaveLength(1);
  expect(calls[0].payload.text).toBe('Привет! Я помогу отслеживать твои привычки.');

  const session = await sessionService.getSession(UID);
  expect(session).toMatchObject({ screen: 'home' });
});

test('/start always opens a fresh message under the command, never editing an old tracked screen', async () => {
  await trackerService.getOrCreateUser(UID);
  await trackerService.setTimezone(UID, 'Europe/Minsk');
  await sessionService.saveSession(UID, 123456, 'trackers:list'); // a stale screen far up the chat

  const { bot, calls } = createAppBot();
  await bot.handleUpdate(commandUpdate(UID, '/start'));

  expect(calls.map((c) => c.method)).toEqual(['sendMessage']); // not editMessageText

  const session = await sessionService.getSession(UID);
  expect(session?.messageId).not.toBe(123456);
  expect(session).toMatchObject({ screen: 'home' });
});
