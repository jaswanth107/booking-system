import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/client";
import type { AdminBooking } from "../../types";

export function AdminBookings() {
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("");
  const [confirming, setConfirming] = useState<AdminBooking | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    api.admin
      .listBookings({ q: q || undefined, date: date || undefined, status: status || undefined })
      .then(({ bookings }) => setBookings(bookings))
      .catch(() => setError("Could not load bookings."));
  }

  useEffect(load, [q, date, status]);

  async function confirmCancel() {
    if (!confirming) return;
    setBusyId(confirming.id);
    try {
      await api.admin.cancelBooking(confirming.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel booking.");
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  }

  async function exportCsv() {
    const blob = await api.admin.exportBookingsCsv({ q: q || undefined, date: date || undefined, status: status || undefined });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bookings.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h2>Bookings</h2>
      <div className="filter-bar">
        <input placeholder="Search name, email, booking ID, resource…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button className="button button-secondary" onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      {error && <p className="notice notice-error">{error}</p>}
      {!bookings ? (
        <p>Loading…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Booking ID</th>
                <th>User</th>
                <th>Resource</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td>{b.bookingRef}</td>
                  <td>
                    {b.userName}
                    <div className="resource-meta">{b.userEmail}</div>
                  </td>
                  <td>{b.resourceName}</td>
                  <td>{new Date(b.startAt).toLocaleString()}</td>
                  <td>{new Date(b.endAt).toLocaleString()}</td>
                  <td>
                    <span className={`badge badge-${b.status.toLowerCase()}`}>{b.status}</span>
                  </td>
                  <td>
                    {b.status === "CONFIRMED" && (
                      <button className="button button-secondary" disabled={busyId === b.id} onClick={() => setConfirming(b)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirming && (
        <div className="modal-backdrop" onClick={() => setConfirming(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p>
              Are you sure you want to cancel booking <strong>{confirming.bookingRef}</strong> for{" "}
              <strong>{confirming.userName}</strong>?
            </p>
            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => setConfirming(null)}>
                Back
              </button>
              <button className="button" onClick={confirmCancel}>
                Confirm cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
