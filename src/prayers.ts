import { CalculationMethod, Coordinates, HighLatitudeRule, Madhab, PrayerTimes } from 'adhan';
import { z } from 'zod';

export const methods = ['MuslimWorldLeague', 'NorthAmerica', 'Egyptian', 'UmmAlQura', 'Karachi', 'Dubai'] as const;
export const settingsSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  timeZone: z.string().max(80).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'Choose a valid IANA timezone'),
  method: z.enum(methods),
  madhab: z.enum(['standard', 'hanafi']),
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
export const prayerNames = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type PrayerName = typeof prayerNames[number];
export class CalculationError extends Error {}

export function localDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function parseDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new CalculationError('Use a Gregorian YYYY-MM-DD date.');
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < '2000-01-01' || date > '2100-12-31') {
    throw new CalculationError('Choose a real date between 2000 and 2100.');
  }
  return parsed;
}

export function daySchedule(input: Settings, date: string) {
  const settings = settingsSchema.parse(input);
  const parsed = parseDate(date);
  // Adhan accepts a calendar date in the runtime's local timezone, not an instant.
  const calendarDate = new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12);
  const params = CalculationMethod[settings.method]();
  params.madhab = settings.madhab === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;
  params.highLatitudeRule = HighLatitudeRule.MiddleOfTheNight;
  const times = new PrayerTimes(new Coordinates(settings.latitude, settings.longitude), calendarDate, params);
  const events = prayerNames.map(name => {
    const instant = times[name];
    if (!Number.isFinite(instant.getTime())) {
      throw new CalculationError('Prayer times are unavailable at this latitude/date. Consult a local mosque; no polar estimate is invented.');
    }
    return {
      id: `${date}:${name}`,
      name,
      at: instant.toISOString(),
      localTime: new Intl.DateTimeFormat('en-GB', { timeZone: settings.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant),
      localDate: localDate(instant, settings.timeZone),
    };
  });
  return { date, timeZone: settings.timeZone, method: settings.method, madhab: settings.madhab, highLatitudeRule: 'middle-of-the-night', events };
}

export function nextPrayer(settings: Settings, now = new Date()) {
  const today = localDate(now, settings.timeZone);
  const tomorrow = parseDate(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const dates = [today, tomorrow.toISOString().slice(0, 10)];
  for (const date of dates) {
    const schedule = daySchedule(settings, date);
    const next = schedule.events.find(event => new Date(event.at).getTime() > now.getTime());
    if (next) return { ...next, timeZone: settings.timeZone, method: settings.method };
  }
  throw new CalculationError('No upcoming prayer was found. Check your location and timezone.');
}
