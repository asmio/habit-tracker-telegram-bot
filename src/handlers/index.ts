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
  // Clears any abandoned text-input state (e.g. /new, a rename prompt) before anything else runs,
  // so a stray message from a different flow is never mistaken for the answer to an old prompt.
  registerPendingInputReset(bot);

  // Order matters. Whatever has to work before the user has picked a time zone (/start,
  // /timezone and the zone picker itself) goes ahead of the gate; everything else behind it.
  registerStartHandler(bot);
  registerTimezoneHandler(bot);
  registerTimezoneGate(bot);

  // The main-menu keyboard's callback buttons go through the gate like any other button; its
  // `bot.hears` aliases re-check the time zone themselves (see commands/menu.handler.ts).
  registerMenuHandler(bot);

  registerNewHandler(bot);
  registerTodayHandler(bot);
  registerTrackersHandler(bot);
  registerCallbackHandler(bot);
}
