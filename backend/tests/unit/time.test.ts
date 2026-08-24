import { describe, it, expect } from "vitest";
import { parseTimestamp, rangesOverlap } from "../../src/utils/time.js";

describe("rangesOverlap (half-open [start, end))", () => {
  it("adjacent bookings do not overlap: 10-11 and 11-12", () => {
    const a = [new Date("2026-01-01T10:00:00Z"), new Date("2026-01-01T11:00:00Z")] as const;
    const b = [new Date("2026-01-01T11:00:00Z"), new Date("2026-01-01T12:00:00Z")] as const;
    expect(rangesOverlap(a[0], a[1], b[0], b[1])).toBe(false);
  });

  it("overlapping bookings: 10-11 and 10:30-11:30", () => {
    const a = [new Date("2026-01-01T10:00:00Z"), new Date("2026-01-01T11:00:00Z")] as const;
    const b = [new Date("2026-01-01T10:30:00Z"), new Date("2026-01-01T11:30:00Z")] as const;
    expect(rangesOverlap(a[0], a[1], b[0], b[1])).toBe(true);
  });

  it("existing 4:00-5:00 vs requested 4:30-5:30 -> overlap", () => {
    const a = [new Date("2026-01-01T16:00:00Z"), new Date("2026-01-01T17:00:00Z")] as const;
    const b = [new Date("2026-01-01T16:30:00Z"), new Date("2026-01-01T17:30:00Z")] as const;
    expect(rangesOverlap(a[0], a[1], b[0], b[1])).toBe(true);
  });

  it("existing 4:00-4:30 vs requested 4:30-5:30 -> no overlap (adjacent)", () => {
    const a = [new Date("2026-01-01T16:00:00Z"), new Date("2026-01-01T16:30:00Z")] as const;
    const b = [new Date("2026-01-01T16:30:00Z"), new Date("2026-01-01T17:30:00Z")] as const;
    expect(rangesOverlap(a[0], a[1], b[0], b[1])).toBe(false);
  });

  it("existing 5:30-6:30 vs requested 4:30-5:30 -> no overlap (adjacent)", () => {
    const a = [new Date("2026-01-01T17:30:00Z"), new Date("2026-01-01T18:30:00Z")] as const;
    const b = [new Date("2026-01-01T16:30:00Z"), new Date("2026-01-01T17:30:00Z")] as const;
    expect(rangesOverlap(a[0], a[1], b[0], b[1])).toBe(false);
  });

  it("existing contains requested", () => {
    const a = [new Date("2026-01-01T09:00:00Z"), new Date("2026-01-01T12:00:00Z")] as const;
    const b = [new Date("2026-01-01T10:00:00Z"), new Date("2026-01-01T11:00:00Z")] as const;
    expect(rangesOverlap(a[0], a[1], b[0], b[1])).toBe(true);
  });

  it("requested contains existing", () => {
    const a = [new Date("2026-01-01T10:00:00Z"), new Date("2026-01-01T11:00:00Z")] as const;
    const b = [new Date("2026-01-01T09:00:00Z"), new Date("2026-01-01T12:00:00Z")] as const;
    expect(rangesOverlap(a[0], a[1], b[0], b[1])).toBe(true);
  });

  it("exact same interval overlaps", () => {
    const a = [new Date("2026-01-01T10:00:00Z"), new Date("2026-01-01T11:00:00Z")] as const;
    expect(rangesOverlap(a[0], a[1], a[0], a[1])).toBe(true);
  });
});

describe("parseTimestamp", () => {
  it("parses valid ISO timestamps", () => {
    expect(parseTimestamp("2026-01-01T10:00:00Z")).toBeInstanceOf(Date);
  });

  it("normalizes an offset timestamp to the same UTC instant as Z", () => {
    // UTC strategy: a timestamp with a +05:30 offset must resolve to the
    // identical instant as its UTC equivalent, regardless of who sent it.
    const withOffset = parseTimestamp("2026-01-01T15:30:00+05:30")!;
    const utc = parseTimestamp("2026-01-01T10:00:00Z")!;
    expect(withOffset.getTime()).toBe(utc.getTime());
  });

  it("rejects garbage input", () => {
    expect(parseTimestamp("not-a-date")).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp(12345)).toBeNull();
  });
});
