// Dates, timezones and the English labels used for calendar nodes.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_ABBR = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const RFC822 =
  /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(GMT|UTC|UT|Z|[+-]\d{4})$/;

/** Parse an RFC 822 date (`Wed, 18 Nov 2026 09:12:03 GMT`). */
export function parseRfc822(value: string): Date | undefined {
  const m = RFC822.exec(value.trim());
  if (!m) return undefined;
  const [, day, mon, year, hh, mm, ss, zone] = m;
  const month = MONTH_ABBR.findIndex((a) => a.toLowerCase() === mon!.toLowerCase());
  if (month < 0) return undefined;
  // Reject impossible dates and times, which Date.UTC would silently roll over.
  if (new Date(Date.UTC(+year!, month, +day!)).getUTCDate() !== +day!) return undefined;
  if (+hh! > 23 || +mm! > 59 || +(ss ?? 0) > 59) return undefined;
  let ms = Date.UTC(+year!, month, +day!, +hh!, +mm!, +(ss ?? 0));
  if (zone!.startsWith("+") || zone!.startsWith("-")) {
    const sign = zone!.startsWith("-") ? -1 : 1;
    ms -= sign * (+zone!.slice(1, 3) * 60 + +zone!.slice(3, 5)) * 60_000;
  }
  return new Date(ms);
}

export function formatRfc822(date: Date): string {
  return date.toUTCString();
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

export function zonedParts(date: Date, tz: string): ZonedParts {
  let fmt = formatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, fmt);
  }
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` of `date` in `tz`. */
export function zonedDate(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** `HHMMSS` of `date` in `tz`, used for entry anchors. */
export function zonedTimeCode(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${pad2(p.hour)}${pad2(p.minute)}${pad2(p.second)}`;
}

/** The instant of 00:00 on `isoDate` (`YYYY-MM-DD`) in `tz`. */
export function zonedMidnight(isoDate: string, tz: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const target = Date.UTC(y, m - 1, d);
  let guess = target;
  // Two passes settle the offset, including across DST changes.
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += target - asUtc;
  }
  return new Date(guess);
}

export function isValidMonth(value: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  return !!m && +m[2]! >= 1 && +m[2]! <= 12;
}

export function isValidDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

/** `2026-11` → `November 2026` */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

/** `2026-11-18` → `18th November` (the label stored in the outline) */
export function dayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${ordinal(d)} ${MONTHS[m - 1]}`;
}

/** `2026-11-18` → `Wednesday 18th November 2026` (used on the site) */
export function longDayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${ordinal(d)} ${MONTHS[m - 1]} ${y}`;
}
