import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Booking } from "../types";
import { formatInTimeZone } from "../utils/timezone";
import { useApp } from "../context";

const CANCELLATION_CUTOFF_MS = 60 * 1000;

type Tab = "upcoming" | "past" | "cancelled";

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
    if (!bookings) return { upcoming: [], past: [], cancelled: [] as Booking[] };
    const upcoming: Booking[] = [];
    const past: Booking[] = [];
    const cancelled: Booking[] = [];
    for (const b of bookings) {
      if (b.status === "CANCELLED") cancelled.push(b);
      else if (new Date(b.endAt).getTime() < now) past.push(b);
      else upcoming.push(b);
    }
    return { upcoming, past, cancelled };
  }, [bookings, now]);

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
      <div className="tabs">
        {(["upcoming", "past", "cancelled"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? "tab-active" : ""}`}
            onClick={() => setTab(t)}
            data-testid={`tab-${t}`}
          >
            {t[0].toUpperCase() + t.slice(1)} ({grouped[t].length})
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
                <div className="resource-meta">Status: {b.status}</div>
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
