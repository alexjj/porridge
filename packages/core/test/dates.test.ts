import { describe, expect, it } from "vitest";
import {
  dayLabel,
  formatRfc822,
  isValidDay,
  isValidMonth,
  longDayLabel,
  monthLabel,
  ordinal,
  parseRfc822,
  zonedDate,
  zonedMidnight,
  zonedTimeCode,
} from "../src/index.js";

describe("parseRfc822", () => {
  it("parses GMT dates and round-trips them", () => {
    const d = parseRfc822("Wed, 18 Nov 2026 09:12:03 GMT")!;
    expect(d.toISOString()).toBe("2026-11-18T09:12:03.000Z");
    expect(formatRfc822(d)).toBe("Wed, 18 Nov 2026 09:12:03 GMT");
  });

  it("accepts numeric offsets, no weekday and no seconds", () => {
    expect(parseRfc822("18 Nov 2026 10:12 +0100")!.toISOString()).toBe("2026-11-18T09:12:00.000Z");
    expect(parseRfc822("Wed, 18 Nov 2026 04:12:03 -0500")!.toISOString()).toBe("2026-11-18T09:12:03.000Z");
  });

  it.each(["last Tuesday", "2026-11-18T09:12:03Z", "Wed, 31 Feb 2026 09:12:03 GMT", "Wed, 18 Nov 2026 25:00:00 GMT", ""])(
    "rejects %j",
    (value) => expect(parseRfc822(value)).toBeUndefined(),
  );
});

describe("timezones", () => {
  const late = parseRfc822("Wed, 15 Jul 2026 23:20:00 GMT")!;

  it("puts the date and anchor time in the blog's timezone", () => {
    expect(zonedDate(late, "Europe/London")).toBe("2026-07-16");
    expect(zonedTimeCode(late, "Europe/London")).toBe("002000");
    expect(zonedDate(late, "UTC")).toBe("2026-07-15");
    expect(zonedTimeCode(late, "America/New_York")).toBe("192000");
  });

  it("finds local midnight, including on DST days", () => {
    expect(zonedMidnight("2026-07-16", "Europe/London").toISOString()).toBe("2026-07-15T23:00:00.000Z");
    expect(zonedMidnight("2026-11-18", "Europe/London").toISOString()).toBe("2026-11-18T00:00:00.000Z");
    expect(zonedMidnight("2026-03-29", "Europe/London").toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(zonedMidnight("2026-10-25", "Europe/London").toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(zonedMidnight("2026-11-18", "Asia/Kolkata").toISOString()).toBe("2026-11-17T18:30:00.000Z");
  });
});

describe("calendar dates and labels", () => {
  it("validates dates", () => {
    expect(isValidMonth("2026-11")).toBe(true);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidDay("2028-02-29")).toBe(true);
    expect(isValidDay("2026-02-29")).toBe(false);
    expect(isValidDay("2026-11-18x")).toBe(false);
  });

  it("formats ordinals", () => {
    const expected = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 11: "11th", 12: "12th", 13: "13th", 21: "21st", 22: "22nd", 23: "23rd", 31: "31st" };
    for (const [n, s] of Object.entries(expected)) expect(ordinal(Number(n))).toBe(s);
  });

  it("makes labels", () => {
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(dayLabel("2026-11-18")).toBe("18th November");
    expect(longDayLabel("2026-11-18")).toBe("Wednesday 18th November 2026");
  });
});
