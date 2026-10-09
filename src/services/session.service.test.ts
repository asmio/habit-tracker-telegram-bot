import { resetDb, setupTestDb } from '../testing/harness';
import { sessionService } from './session.service';

beforeAll(setupTestDb);
beforeEach(resetDb);

const UID = 1;

test('getSession returns undefined when nothing was ever saved', async () => {
  expect(await sessionService.getSession(UID)).toBeUndefined();
});

test('saveSession then getSession round-trips messageId and screen', async () => {
  await sessionService.saveSession(UID, 42, 'trackers:open:5');
  const session = await sessionService.getSession(UID);
  expect(session).toMatchObject({ telegramId: UID, messageId: 42, screen: 'trackers:open:5' });
});

test('saveSession again for the same user overwrites, not duplicates -- one session per user', async () => {
  await sessionService.saveSession(UID, 1, 'home');
  await sessionService.saveSession(UID, 2, 'trackers:list');

  const session = await sessionService.getSession(UID);
  expect(session).toMatchObject({ messageId: 2, screen: 'trackers:list' });
});

test('sessions for different users are independent', async () => {
  await sessionService.saveSession(1, 10, 'home');
  await sessionService.saveSession(2, 20, 'trackers:list');

  expect(await sessionService.getSession(1)).toMatchObject({ messageId: 10, screen: 'home' });
  expect(await sessionService.getSession(2)).toMatchObject({ messageId: 20, screen: 'trackers:list' });
});

test('saveSession works even without a users row for that telegramId -- no FK on purpose', async () => {
  await expect(sessionService.saveSession(999, 1, 'home')).resolves.toBeUndefined();
});

test('clearSession removes it; getSession then returns undefined again', async () => {
  await sessionService.saveSession(UID, 1, 'home');
  await sessionService.clearSession(UID);
  expect(await sessionService.getSession(UID)).toBeUndefined();
});

test('clearSession for a user with no session is a harmless no-op', async () => {
  await expect(sessionService.clearSession(UID)).resolves.toBeUndefined();
});
