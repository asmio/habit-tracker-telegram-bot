import { Bot } from 'grammy';
import { registerCallbackHandler } from './commands/callback.handler';
import { registerMenuHandler } from './commands/menu.handler';
import { registerNewHandler } from './commands/new.handler';
import { registerStartHandler } from './commands/start.handler';
import { registerTimezoneHandler } from './commands/timezone.handler';
import { registerTodayHandler } from './commands/today.handler';
import { registerTrackersHandler } from './commands/trackers.handler';
import { registerPendingInputReset } from './middleware/pending-input';
import { registerTimezoneGate } from './middleware/timezone-gate';

export function registerHandlers(bot: Bot): void {
  // Clears any abandoned text-input state (e.g. a new-tracker or rename prompt) before anything
  // else runs, so a stray message from a different flow is never mistaken for the answer to an old prompt.
  registerPendingInputReset(bot);

  // Order matters. /start and the zone picker itself must work before the user has picked a time
  // zone, so they go ahead of the gate; everything else behind it.
  registerStartHandler(bot);
  registerTimezoneHandler(bot);
  registerTimezoneGate(bot);

  registerMenuHandler(bot);

  registerNewHandler(bot);
  registerTodayHandler(bot);
  registerTrackersHandler(bot);
  registerCallbackHandler(bot);
}
