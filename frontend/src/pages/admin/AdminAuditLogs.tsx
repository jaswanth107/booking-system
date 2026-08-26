import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { AuditLogEntry } from "../../types";

export function AdminAuditLogs() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .listAuditLogs()
      .then(({ entries }) => setEntries(entries))
      .catch(() => setError("Could not load audit logs."));
  }, []);

  if (error) return <p className="notice notice-error">{error}</p>;
  if (!entries) return <p>Loading…</p>;

  return (
    <div>
      <h2>Audit log</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString()}</td>
                <td>{e.actorEmail ?? "—"}</td>
                <td>{e.action}</td>
                <td>
                  {e.entityType ? `${e.entityType}${e.entityId ? ` (${e.entityId.slice(0, 8)})` : ""}` : "—"}
                </td>
                <td className="audit-details">{e.details ? JSON.stringify(JSON.parse(e.details)) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
