import { InlineKeyboard, type Bot } from 'grammy';
import { schedule, type ScheduledTask } from 'node-cron';
import { logger } from '../logger';
import { todayDate, trackerService, type ReminderCandidate } from '../services/tracker.service';

/** `HH:MM` right now in the given IANA zone -- the same format `reminderTime` is stored in. */
function currentTime(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const { hour, minute } = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${hour}:${minute}`;
}

function reminderKeyboard(itemId: number): InlineKeyboard {
  return InlineKeyboard.from([
    [InlineKeyboard.text('✅ Отметить', `reminder:check:${itemId}`), InlineKeyboard.text('🏠 Главная', 'reminder:home')],
  ]);
}

async function sendReminder(bot: Bot, candidate: ReminderCandidate, date: string): Promise<void> {
  try {
    await bot.api.sendMessage(candidate.telegramId, `📋 ${candidate.trackerName}\n⏰ ${candidate.itemLabel}`, {
      reply_markup: reminderKeyboard(candidate.itemId),
    });
    // Recorded only once the send actually succeeds -- a failed send (e.g. the user blocked the
    // bot) leaves no log, but that's moot either way: this exact minute won't match again today.
    await trackerService.recordReminderSent(candidate.itemId, date);
  } catch (error) {
    logger.error('Failed to send a reminder', {
      itemId: candidate.itemId,
      telegramId: candidate.telegramId,
      error,
    });
  }
}

/**
 * One tick of the scheduler: every item whose reminder time matches its owner's current local
 * time, skipping one already sent or already checked today. Exported (rather than only reachable
 * through the cron callback below) so tests can call it directly with a fixed `now`, instead of
 * waiting for a real clock minute to line up.
 */
export async function runReminderTick(bot: Bot, now: Date = new Date()): Promise<void> {
  const candidates = await trackerService.getReminderCandidates();
  for (const candidate of candidates) {
    if (currentTime(candidate.timezone, now) !== candidate.reminderTime) continue;

    const date = todayDate(candidate.timezone, now);
    if (await trackerService.hasReminderLog(candidate.itemId, date)) continue;
    if (await trackerService.isItemChecked(candidate.itemId, date)) continue;

    await sendReminder(bot, candidate, date);
  }
}

/**
 * Starts the once-a-minute reminder check, in the same process as the bot (see src/index.ts).
 * `noOverlap` skips a tick outright if the previous one is still running, rather than letting two
 * ticks race over the same candidates.
 */
export function startReminderScheduler(bot: Bot): ScheduledTask {
  return schedule(
    '* * * * *',
    (context) => {
      void runReminderTick(bot, context.date).catch((error) => {
        logger.error('Reminder scheduler tick failed', { error });
      });
    },
    { noOverlap: true },
  );
}
