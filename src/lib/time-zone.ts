/**
 * Wall-clock arithmetic in a named IANA time zone, with nothing but `Intl`.
 *
 * A school runs on its own clock. Until the scheduler existed nothing needed
 * that clock — quiet hours were checked in UTC and the settings page said so
 * — but "send at 07:00" and "three days before the due date" are both
 * questions about the school's calendar, and answering them in UTC puts an
 * Indian school's 9pm cut-off at 2:30 in the morning.
 *
 * Every function takes the zone explicitly. There is no ambient default, so
 * a caller that forgot to find out which school it is working for gets a
 * type error rather than a message at the wrong hour.
 */

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallClock(at: Date, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(at)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour! % 24, minute: parts.minute!, second: parts.second! };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar date at `at` in that zone, as YYYY-MM-DD. */
export function localDateISO(at: Date, timeZone: string): string {
  const w = wallClock(at, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Minutes since local midnight at `at` in that zone (0–1439). */
export function minutesOfDay(at: Date, timeZone: string): number {
  const w = wallClock(at, timeZone);
  return w.hour * 60 + w.minute;
}

/** Whole calendar days from one YYYY-MM-DD to another; negative when `to` is earlier. */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** How far the zone's wall clock is ahead of UTC at that instant, in ms. */
function offsetMs(at: Date, timeZone: string): number {
  const w = wallClock(at, timeZone);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * "2026-09-15T07:00" as read on a clock in that zone → the UTC instant.
 *
 * This is what an `<input type="datetime-local">` needs: the browser sends
 * the wall-clock time the person typed, with no zone attached. Returns null
 * for anything that isn't a well-formed local date-time.
 *
 * Near a daylight-saving jump a wall-clock time can be ambiguous or not
 * exist at all; the second offset lookup settles on a real instant either
 * way. Asia/Kolkata has no DST, so for the schools this was built for the
 * question never arises.
 */
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  // Date.UTC silently rolls 2026-02-31 over into March; refuse it instead.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59) return null;

  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/** "2026-09-15 07:00" on the zone's clock — for showing a time back to the school. */
export function formatWallClock(at: Date, timeZone: string): string {
  const w = wallClock(at, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
}

/** The value an `<input type="datetime-local">` expects for this instant. */
export function toDateTimeLocalValue(at: Date, timeZone: string): string {
  return formatWallClock(at, timeZone).replace(" ", "T");
}
