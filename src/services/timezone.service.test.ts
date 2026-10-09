import { isValidTimezone } from './tracker.service';
import { POPULAR_TIMEZONES, timezoneButtonLabel, timezoneFromLocation } from './timezone.service';

describe('POPULAR_TIMEZONES', () => {
  test('every entry is a real IANA zone with a non-empty title', () => {
    for (const { zone, title } of POPULAR_TIMEZONES) {
      expect(isValidTimezone(zone)).toBe(true);
      expect(title.length).toBeGreaterThan(0);
    }
  });

  test('includes UTC', () => {
    expect(POPULAR_TIMEZONES.some((z) => z.zone === 'UTC')).toBe(true);
  });
});

describe('timezoneButtonLabel', () => {
  test('shows the zone\'s current UTC offset next to its title', () => {
    const minsk = { zone: 'Europe/Minsk', title: 'Минск' }; // fixed UTC+3, no DST
    expect(timezoneButtonLabel(minsk, new Date('2026-01-01T00:00:00Z'))).toBe('Минск (GMT+3)');
  });

  test('UTC itself is special-cased to "GMT+0" (Intl reports it as bare "GMT")', () => {
    const utc = { zone: 'UTC', title: 'UTC' };
    expect(timezoneButtonLabel(utc, new Date('2026-01-01T00:00:00Z'))).toBe('UTC (GMT+0)');
  });

  test('a zone with daylight saving shows a different offset in winter vs summer', () => {
    const berlin = { zone: 'Europe/Berlin', title: 'Берлин' };
    expect(timezoneButtonLabel(berlin, new Date('2026-01-15T12:00:00Z'))).toBe('Берлин (GMT+1)');
    expect(timezoneButtonLabel(berlin, new Date('2026-07-15T12:00:00Z'))).toBe('Берлин (GMT+2)');
  });
});

describe('timezoneFromLocation', () => {
  test('resolves real coordinates to their IANA zone', () => {
    expect(timezoneFromLocation(53.9, 27.5667)).toBe('Europe/Minsk'); // Minsk
  });

  test('returns undefined for out-of-range coordinates instead of throwing', () => {
    expect(timezoneFromLocation(999, 999)).toBeUndefined();
  });
});
