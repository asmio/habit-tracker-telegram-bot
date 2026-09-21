import { Bot } from 'grammy';
import { registerAddItemHandler } from './additem.handler';
import { registerCallbackHandler } from './callback.handler';
import { registerNewHandler } from './new.handler';
import { registerStartHandler } from './start.handler';
import { registerTimezoneGate } from './timezone-gate';
import { registerTimezoneHandler } from './timezone.handler';
import { registerTodayHandler } from './today.handler';

export function registerHandlers(bot: Bot): void {
  // Order matters. Whatever has to work before the user has picked a time zone (/start,
  // /timezone and the zone picker itself) goes ahead of the gate; everything else behind it.
  registerStartHandler(bot);
  registerTimezoneHandler(bot);
  registerTimezoneGate(bot);

  registerNewHandler(bot);
  registerAddItemHandler(bot);
  registerTodayHandler(bot);
  registerCallbackHandler(bot);
}
