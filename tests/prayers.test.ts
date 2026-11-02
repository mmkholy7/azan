import { describe, expect, it } from 'vitest';
import { daySchedule, localDate, nextPrayer, parseDate, settingsSchema, type Settings } from '../src/prayers';

const cairo: Settings = { latitude: 30.0444, longitude: 31.2357, timeZone: 'Africa/Cairo', method: 'Egyptian', madhab: 'standard' };
const ny: Settings = { latitude: 40.7128, longitude: -74.006, timeZone: 'America/New_York', method: 'NorthAmerica', madhab: 'standard' };

describe('prayer calculations', () => {
  it('returns five ordered UTC instants with explicit timezone and deterministic event IDs', () => {
    const day = daySchedule(cairo, '2026-11-01');
    expect(day.events.map(event => event.name)).toEqual(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);
    expect(day).toEqual(daySchedule(cairo, '2026-11-01'));
    for (let i = 1; i < day.events.length; i++) expect(day.events[i].at > day.events[i - 1].at).toBe(true);
    expect(day.events.every(event => event.localDate === day.date && event.at.endsWith('Z'))).toBe(true);
    // Independent broad solar sanity check: Cairo sunset is about 17:05, not UTC 17:05.
    const sunset = day.events.find(event => event.name === 'maghrib')!;
    expect(sunset.localTime >= '16:55' && sunset.localTime <= '17:15').toBe(true);
  });
  it('uses the location timezone rather than the machine date', () => {
    const instant = new Date('2026-11-02T00:30:00Z');
    expect(localDate(instant, ny.timeZone)).toBe('2026-11-01');
    expect(localDate(instant, 'Asia/Tokyo')).toBe('2026-11-02');
    expect(nextPrayer(ny, instant).name).toBe('fajr');
    expect(nextPrayer(ny, instant).id).toBe('2026-11-02:fajr');
  });
  it.each(['2026-03-08', '2026-11-01'])('keeps local dates and IANA offsets correct across New York DST: %s', date => {
    const day = daySchedule(ny, date);
    for (const event of day.events) {
      expect(localDate(new Date(event.at), ny.timeZone)).toBe(date);
      expect(event.localTime).toBe(new Intl.DateTimeFormat('en-GB', { timeZone: ny.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(event.at)));
    }
    const fajr = day.events[0];
    const utcHour = Number(fajr.at.slice(11, 13));
    const localHour = Number(fajr.localTime.slice(0, 2));
    expect(utcHour - localHour).toBe(date === '2026-03-08' ? 4 : 5);
  });
  it('moves to the next prayer exactly at a prayer instant and rolls over after isha', () => {
    const events = daySchedule(cairo, '2026-11-01').events;
    expect(nextPrayer(cairo, new Date(events[0].at)).name).toBe('dhuhr');
    expect(nextPrayer(cairo, new Date(events[4].at)).id).toBe('2026-11-02:fajr');
  });
  it('supports Hanafi Asr and named calculation methods', () => {
    const standard = daySchedule(cairo, '2026-11-01');
    const hanafi = daySchedule({ ...cairo, madhab: 'hanafi' }, '2026-11-01');
    expect(hanafi.events[2].at > standard.events[2].at).toBe(true);
    expect(hanafi.events[0].at).toBe(standard.events[0].at);
    expect(daySchedule({ ...cairo, method: 'MuslimWorldLeague' }, '2026-11-01').events[0].at).not.toBe(standard.events[0].at);
  });
  it.each([
    { latitude: -36.8485, longitude: 174.7633, timeZone: 'Pacific/Auckland' },
    { latitude: 21.3069, longitude: -157.8583, timeZone: 'Pacific/Honolulu' },
  ])('keeps the correct local prayer date near the date line: $timeZone', location => {
    const settings = { ...ny, ...location };
    const day = daySchedule(settings, '2026-11-02');
    expect(day.events.every(event => event.localDate === '2026-11-02')).toBe(true);
    const beforeFajr = new Date(new Date(day.events[0].at).getTime() - 60_000);
    expect(nextPrayer(settings, beforeFajr).id).toBe('2026-11-02:fajr');
  });
  it('rejects invalid timezone, latitude, method and calendar date instead of defaulting', () => {
    expect(() => settingsSchema.parse({ ...cairo, timeZone: 'Mars/Olympus' })).toThrow();
    expect(() => settingsSchema.parse({ ...cairo, latitude: 91 })).toThrow();
    expect(() => settingsSchema.parse({ ...cairo, method: 'unknown' })).toThrow();
    for (const date of ['2026-02-30', '2025-02-29', 'no', '1999-01-01']) expect(() => parseDate(date)).toThrow();
  });
  it('reports polar unavailable events explicitly', () => {
    expect(() => daySchedule({ ...ny, latitude: 89, longitude: 0, timeZone: 'UTC' }, '2026-06-21')).toThrow(/unavailable/);
  });
});
