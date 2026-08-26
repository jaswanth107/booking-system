import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Booking, Resource } from "../types";
import { SlotTakenNotice } from "../components/SlotTakenNotice";
import { formatInTimeZone } from "../utils/timezone";
import { useApp } from "../context";

function todayLocalDate(): string {
  const d = new Date();
  const offsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10);
}

export function BookingPage() {
  const { resourceId = "" } = useParams();
  const navigate = useNavigate();
  const { timeZone } = useApp();

  const [resource, setResource] = useState<Resource | null>(null);
  const [date, setDate] = useState(todayLocalDate());
  const [startTime, setStartTime] = useState("16:30");
  const [endTime, setEndTime] = useState("17:30");
  const [availability, setAvailability] = useState<"unknown" | "checking" | "available" | "unavailable">(
    "unknown"
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorIsSlotTaken, setErrorIsSlotTaken] = useState(false);
  const [confirmed, setConfirmed] = useState<Booking | null>(null);

  useEffect(() => {
    api.getResource(resourceId).then(({ resource }) => setResource(resource)).catch(() => setResource(null));
  }, [resourceId]);

  const { startIso, endIso, rangeValid } = useMemo(() => {
    if (!date || !startTime || !endTime) return { startIso: "", endIso: "", rangeValid: false };
    const start = new Date(`${date}T${startTime}:00`);
    const end = new Date(`${date}T${endTime}:00`);
    const valid = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start < end;
    return { startIso: start.toISOString(), endIso: end.toISOString(), rangeValid: valid };
  }, [date, startTime, endTime]);

  useEffect(() => {
    if (!rangeValid || !resourceId) {
      setAvailability("unknown");
      return;
    }
    let cancelled = false;
    setAvailability("checking");
    const timer = setTimeout(() => {
      api
        .checkAvailability(resourceId, startIso, endIso)
        .then(({ available }) => {
          if (!cancelled) setAvailability(available ? "available" : "unavailable");
        })
        .catch(() => {
          if (!cancelled) setAvailability("unknown");
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [resourceId, startIso, endIso, rangeValid]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorIsSlotTaken(false);
    setSubmitting(true);
    try {
      const { booking } = await api.createBooking(resourceId, startIso, endIso);
      setConfirmed(booking);
      setAvailability("unavailable");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const takenLike = err.code === "SLOT_TAKEN" || err.code === "RESOURCE_UNAVAILABLE";
        setErrorIsSlotTaken(takenLike);
        if (takenLike) setAvailability("unavailable");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function tryNextHour() {
    const [h, m] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const next = (hh: number, mm: number) => {
      const total = hh * 60 + mm + 60;
      return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    };
    setStartTime(next(h, m));
    setEndTime(next(eh, em));
    setError(null);
    setErrorIsSlotTaken(false);
  }

  if (!resource) return <p>Loading…</p>;

  if (confirmed) {
    return (
      <section className="confirmation" data-testid="booking-confirmation">
        <h1>Booking confirmed</h1>
        <p className="notice notice-success">Booking confirmed successfully.</p>
        <dl>
          <dt>Booking ID</dt>
          <dd>{confirmed.bookingRef}</dd>
          <dt>Resource</dt>
          <dd>{resource.name}</dd>
          <dt>Date</dt>
          <dd>{formatInTimeZone(confirmed.startAt, timeZone).split(",")[0]}</dd>
          <dt>Start</dt>
          <dd>{formatInTimeZone(confirmed.startAt, timeZone)}</dd>
          <dt>End</dt>
          <dd>{formatInTimeZone(confirmed.endAt, timeZone)}</dd>
          <dt>Timezone</dt>
          <dd>{timeZone}</dd>
          <dt>Status</dt>
          <dd>{confirmed.status}</dd>
        </dl>
        <button className="button" onClick={() => navigate("/my-bookings")}>
          View my bookings
        </button>
      </section>
    );
  }

  return (
    <section>
      <h1 data-testid="resource-name">Book: {resource.name}</h1>
      <p className="resource-meta">
        {resource.location}
        {resource.capacity !== null ? ` · Capacity ${resource.capacity}` : ""}
      </p>

      <form className="booking-form" onSubmit={handleSubmit}>
        <label>
          Date
          <input
            type="date"
            data-testid="date-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <label>
          Start time
          <input
            type="time"
            data-testid="start-input"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </label>
        <label>
          End time
          <input
            type="time"
            data-testid="end-input"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            required
          />
        </label>

        {!rangeValid && <p className="notice notice-warning">End time must be after start time.</p>}

        {rangeValid && (
          <p
            className={`availability-badge availability-${availability}`}
            data-testid="availability-badge"
          >
            {availability === "checking" && "Checking availability…"}
            {availability === "available" && "Available"}
            {availability === "unavailable" && "Unavailable"}
            {availability === "unknown" && ""}
          </p>
        )}

        {error &&
          (errorIsSlotTaken ? (
            <div>
              <SlotTakenNotice message={error} />
              <button type="button" className="button button-secondary" onClick={tryNextHour}>
                Try one hour later
              </button>
            </div>
          ) : (
            <p className="notice notice-error" data-testid="booking-error">
              {error}
            </p>
          ))}

        <button
          type="submit"
          className="button"
          data-testid="submit-booking"
          disabled={submitting || !rangeValid}
        >
          {submitting ? "Booking…" : "Book"}
        </button>
      </form>
    </section>
  );
}
