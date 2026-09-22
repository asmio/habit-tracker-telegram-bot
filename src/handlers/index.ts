import { Bot } from 'grammy';
import { registerAddItemHandler } from './additem.handler';
import { registerCallbackHandler } from './callback.handler';
import { registerDeleteItemHandler } from './deleteitem.handler';
import { registerDeleteTrackerHandler } from './deletetracker.handler';
import { registerEditItemHandler } from './edititem.handler';
import { registerMenuHandler } from './menu.handler';
import { registerNewHandler } from './new.handler';
import { registerPendingInputReset } from './pending-input';
import { registerReorderHandler } from './reorder.handler';
import { registerStartHandler } from './start.handler';
import { registerTimezoneGate } from './timezone-gate';
import { registerTimezoneHandler } from './timezone.handler';
import { registerTodayHandler } from './today.handler';

export function registerHandlers(bot: Bot): void {
  // Clears any abandoned /additem or /edititem text-input state before anything else runs, so a
  // stray message from a different flow is never mistaken for the answer to an old prompt.
  registerPendingInputReset(bot);

  // Order matters. Whatever has to work before the user has picked a time zone (/start,
  // /timezone and the zone picker itself) goes ahead of the gate; everything else behind it.
  registerStartHandler(bot);
  registerTimezoneHandler(bot);
  registerTimezoneGate(bot);

  // The main-menu keyboard's callback buttons (`menu:*`) go through the gate like any other
  // button; its `bot.hears` aliases re-check the time zone themselves (see menu.handler.ts).
  registerMenuHandler(bot);

  registerNewHandler(bot);
  registerAddItemHandler(bot);
  registerTodayHandler(bot);
  registerCallbackHandler(bot);
  registerEditItemHandler(bot);
  registerDeleteItemHandler(bot);
  registerDeleteTrackerHandler(bot);
  registerReorderHandler(bot);
}
