/**
 * All business-logic time comparisons happen on UTC epoch milliseconds.
 * Clients may send any ISO-8601 timestamp (with an offset or "Z"); Date
 * parsing normalizes it to a UTC instant before storage/comparison.
 */

export function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function toUtcIso(date: Date): string {
  return date.toISOString();
}

/** True when [aStart, aEnd) overlaps [bStart, bEnd). Half-open intervals. */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

export const CANCELLATION_CUTOFF_MS = 60 * 1000; // 1 minute before start
