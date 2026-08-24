export const DEVICE_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const COMMON_TIMEZONES = Array.from(
  new Set([DEVICE_TIMEZONE, "UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"])
);

/** Formats a UTC ISO timestamp for display in the given IANA timezone. */
export function formatInTimeZone(isoUtc: string, timeZone: string): string {
  const date = new Date(isoUtc);
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function formatDateInTimeZone(isoUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium" }).format(new Date(isoUtc));
}

export function formatTimeInTimeZone(isoUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, timeStyle: "short" }).format(new Date(isoUtc));
}

/**
 * A <input type="datetime-local"> value has no timezone info; the browser
 * treats it as wall-clock time in the *device's* local timezone, so
 * `new Date(value)` already resolves to the correct UTC instant. We keep
 * booking creation tied to the device timezone (simplest, least error-prone)
 * and use `formatInTimeZone` above only for display, which can use a
 * user-selected timezone independent of the device.
 */
export function localInputValueToUtcIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
