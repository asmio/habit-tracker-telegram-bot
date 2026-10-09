import { sessionService } from '../../services/session.service';
import { trackerService } from '../../services/tracker.service';
import { callbackUpdate, createAppBot, resetDb, setupTestDb, textUpdate } from '../../testing/harness';

const UID = 1;

beforeAll(setupTestDb);
beforeEach(async () => {
  resetDb();
  await trackerService.getOrCreateUser(UID);
  await trackerService.setTimezone(UID, 'Europe/Minsk');
});

async function openPrompt(bot: ReturnType<typeof createAppBot>['bot']) {
  await bot.handleUpdate(callbackUpdate(UID, 'trackers:new', { messageId: 10 }));
}

test('a valid name creates the tracker and lands on the trackers list', async () => {
  const { bot, calls } = createAppBot();
  await openPrompt(bot);
  await bot.handleUpdate(textUpdate(UID, 'Утро'));

  const trackers = await trackerService.getTrackers(UID);
  expect(trackers.map((t) => t.name)).toEqual(['Утро']);
  expect(calls.at(-1)?.payload.text).toBe('🗂 Твои трекеры:');
});

test('an empty name (after trimming) is rejected and re-prompts on the same screen', async () => {
  const { bot, calls } = createAppBot();
  await openPrompt(bot);
  await bot.handleUpdate(textUpdate(UID, '   '));

  expect(calls.at(-1)?.payload.text).toMatch(/Название не может быть пустым/);
  expect(await trackerService.getTrackers(UID)).toEqual([]);
  expect(await sessionService.getSession(UID)).toMatchObject({ screen: 'trackers:new' });
});

test('a name over 64 characters is rejected', async () => {
  const { bot, calls } = createAppBot();
  await openPrompt(bot);
  await bot.handleUpdate(textUpdate(UID, 'x'.repeat(65)));

  expect(calls.at(-1)?.payload.text).toMatch(/Слишком длинное название/);
  expect(await trackerService.getTrackers(UID)).toEqual([]);
});

test('typing while not on the new-tracker screen is ignored by this handler', async () => {
  const { bot, calls } = createAppBot();
  await bot.handleUpdate(textUpdate(UID, 'Утро'));

  expect(calls).toHaveLength(0);
  expect(await trackerService.getTrackers(UID)).toEqual([]);
});
