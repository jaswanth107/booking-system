import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Booking } from "../types";
import { formatInTimeZone } from "../utils/timezone";
import { useApp } from "../context";

const CANCELLATION_CUTOFF_MS = 60 * 1000;
const REMINDER_WINDOW_MS = 30 * 60 * 1000;

type Tab = "upcoming" | "completed" | "cancelled";
const TAB_LABEL: Record<Tab, string> = { upcoming: "Upcoming", completed: "Completed", cancelled: "Cancelled" };

export function MyBookings() {
  const { timeZone } = useApp();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  function load() {
    api
      .listMyBookings()
      .then(({ bookings }) => setBookings(bookings))
      .catch(() => setError("Could not load your bookings."));
  }

  useEffect(load, []);

  const grouped = useMemo(() => {
    if (!bookings) return { upcoming: [], completed: [], cancelled: [] as Booking[] };
    const upcoming: Booking[] = [];
    const completed: Booking[] = [];
    const cancelled: Booking[] = [];
    for (const b of bookings) {
      if (b.status === "CANCELLED") cancelled.push(b);
      else if (new Date(b.endAt).getTime() < now) completed.push(b);
      else upcoming.push(b);
    }
    return { upcoming, completed, cancelled };
  }, [bookings, now]);

  const soonest = useMemo(() => {
    const next = grouped.upcoming
      .map((b) => ({ b, msUntil: new Date(b.startAt).getTime() - now }))
      .filter((x) => x.msUntil > 0 && x.msUntil <= REMINDER_WINDOW_MS)
      .sort((a, c) => a.msUntil - c.msUntil)[0];
    return next;
  }, [grouped.upcoming, now]);

  async function handleCancel(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.cancelBooking(id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel this booking.");
    } finally {
      setBusyId(null);
    }
  }

  if (!bookings) return <p>Loading…</p>;

  const list = grouped[tab];

  return (
    <section>
      <h1>My bookings</h1>

      {soonest && (
        <p className="notice notice-warning" data-testid="upcoming-reminder">
          Your booking ({soonest.b.bookingRef}) starts in {Math.ceil(soonest.msUntil / 60_000)} minute
          {Math.ceil(soonest.msUntil / 60_000) === 1 ? "" : "s"}.
        </p>
      )}

      <div className="tabs">
        {(["upcoming", "completed", "cancelled"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? "tab-active" : ""}`}
            onClick={() => setTab(t)}
            data-testid={`tab-${t}`}
          >
            {TAB_LABEL[t]} ({grouped[t].length})
          </button>
        ))}
      </div>

      {error && <p className="notice notice-error">{error}</p>}

      {list.length === 0 && <p>Nothing here yet.</p>}

      <ul className="booking-list">
        {list.map((b) => {
          const msUntilStart = new Date(b.startAt).getTime() - now;
          const canCancel = b.status === "CONFIRMED" && msUntilStart >= CANCELLATION_CUTOFF_MS;
          return (
            <li key={b.id} className="booking-item" data-testid="booking-item">
              <div>
                <strong>{formatInTimeZone(b.startAt, timeZone)}</strong> —{" "}
                {formatInTimeZone(b.endAt, timeZone)}
                <div className="resource-meta">
                  {b.bookingRef} · Status: {b.status}
                </div>
              </div>
              {canCancel && (
                <button
                  className="button button-secondary"
                  disabled={busyId === b.id}
                  onClick={() => handleCancel(b.id)}
                >
                  {busyId === b.id ? "Cancelling…" : "Cancel"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
