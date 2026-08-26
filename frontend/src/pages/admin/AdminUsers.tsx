import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/client";
import type { AdminUserRow } from "../../types";
import { useApp } from "../../context";

export function AdminUsers() {
  const { user: me } = useApp();
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminUserRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    api.admin
      .listUsers()
      .then(({ users }) => setUsers(users))
      .catch(() => setError("Could not load users."));
  }

  useEffect(load, []);

  async function confirmToggle() {
    if (!confirming) return;
    const nextStatus = confirming.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setBusyId(confirming.id);
    setError(null);
    try {
      const { users } = await api.admin.setUserStatus(confirming.id, nextStatus);
      setUsers(users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update user status.");
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  }

  if (error && !users) return <p className="notice notice-error">{error}</p>;
  if (!users) return <p>Loading…</p>;

  return (
    <div>
      <h2>Users</h2>
      {error && <p className="notice notice-error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Registered</th>
              <th>Last login</th>
              <th>Bookings</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>
                  <span className={`badge badge-${u.status.toLowerCase()}`}>{u.status}</span>
                </td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}</td>
                <td>{u.bookingCount}</td>
                <td>
                  {u.id !== me?.id && (
                    <button
                      className="button button-secondary"
                      disabled={busyId === u.id}
                      onClick={() => setConfirming(u)}
                    >
                      {u.status === "ACTIVE" ? "Deactivate" : "Activate"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirming && (
        <div className="modal-backdrop" onClick={() => setConfirming(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p>
              Are you sure you want to {confirming.status === "ACTIVE" ? "deactivate" : "activate"}{" "}
              <strong>{confirming.name}</strong>?
            </p>
            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button className="button" onClick={confirmToggle}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
