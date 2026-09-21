import tzlookup from 'tz-lookup';
import { isValidTimezone } from './tracker.service';

export const POPULAR_TIMEZONES = [
  { zone: 'Europe/Minsk', title: 'Минск' },
  { zone: 'Europe/Moscow', title: 'Москва' },
  { zone: 'Europe/Kyiv', title: 'Киев' },
  { zone: 'Europe/Warsaw', title: 'Варшава' },
  { zone: 'Europe/Berlin', title: 'Берлин' },
  { zone: 'Europe/London', title: 'Лондон' },
  { zone: 'Asia/Tbilisi', title: 'Тбилиси' },
  { zone: 'Asia/Yerevan', title: 'Ереван' },
  { zone: 'Asia/Baku', title: 'Баку' },
  { zone: 'Asia/Almaty', title: 'Алматы' },
  { zone: 'Asia/Tashkent', title: 'Ташкент' },
  { zone: 'Asia/Dubai', title: 'Дубай' },
  { zone: 'America/New_York', title: 'Нью-Йорк' },
  { zone: 'America/Chicago', title: 'Чикаго' },
  { zone: 'America/Los_Angeles', title: 'Лос-Анджелес' },
  { zone: 'UTC', title: 'UTC' },
] as const;

/** Button caption with the zone's offset right now, e.g. `Минск (GMT+3)`; the offset shifts with daylight saving time. */
export function timezoneButtonLabel(
  { zone, title }: { zone: string; title: string },
  now: Date = new Date(),
): string {
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
    .formatToParts(now)
    .find((part) => part.type === 'timeZoneName')?.value;
  return `${title} (${offset === 'GMT' ? 'GMT+0' : offset})`;
}

/** IANA zone for the coordinates, or `undefined` if they are out of range or the lookup gives nothing usable. */
export function timezoneFromLocation(latitude: number, longitude: number): string | undefined {
  try {
    const zone = tzlookup(latitude, longitude);
    return isValidTimezone(zone) ? zone : undefined;
  } catch {
    return undefined;
  }
}
