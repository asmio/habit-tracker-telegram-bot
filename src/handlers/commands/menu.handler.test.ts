import { sessionService } from '../../services/session.service';
import { trackerService } from '../../services/tracker.service';
import { callbackUpdate, createAppBot, resetDb, setupTestDb } from '../../testing/harness';

const UID = 1;

beforeAll(setupTestDb);
beforeEach(resetDb);

beforeEach(async () => {
  await trackerService.getOrCreateUser(UID);
  await trackerService.setTimezone(UID, 'Europe/Minsk'); // past the timezone gate for every test here
});

async function tap(data: string) {
  const { bot, calls } = createAppBot();
  await bot.handleUpdate(callbackUpdate(UID, data, { messageId: 10 }));
  return calls;
}

test('the home route renders the home screen', async () => {
  const calls = await tap('home');
  expect(calls.at(-1)?.payload.text).toMatch(/Привет!/);
  expect(await sessionService.getSession(UID)).toMatchObject({ screen: 'home' });
});

test('home:today renders the today screen', async () => {
  const calls = await tap('home:today');
  expect(calls.at(-1)?.payload.text).toBe('У тебя пока нет трекеров.'); // no trackers yet
  expect(await sessionService.getSession(UID)).toMatchObject({ screen: 'home:today' });
});

test('home:trackers renders the trackers list', async () => {
  const calls = await tap('home:trackers');
  expect(calls.at(-1)?.payload.text).toBe('Трекеров пока нет.');
  expect(await sessionService.getSession(UID)).toMatchObject({ screen: 'trackers:list' });
});

test('trackers:new opens the new-tracker name prompt', async () => {
  const calls = await tap('trackers:new');
  expect(calls.at(-1)?.payload.text).toBe('Как назвать новый трекер?');
  expect(await sessionService.getSession(UID)).toMatchObject({ screen: 'trackers:new' });
});

test('the settings route renders the settings screen', async () => {
  const calls = await tap('home:settings');
  expect(calls.at(-1)?.payload.text).toBe('⚙️ Настройки');
  expect(await sessionService.getSession(UID)).toMatchObject({ screen: 'home:settings' });
});

test('settings:timezone opens the zone picker, mentioning the already-confirmed zone', async () => {
  const calls = await tap('settings:timezone');
  expect(calls.at(-1)?.payload.text).toMatch(/Сейчас: Europe\/Minsk/);
  expect(await sessionService.getSession(UID)).toMatchObject({ screen: 'settings:timezone' });
});
