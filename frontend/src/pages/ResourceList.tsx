import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Resource } from "../types";

const STATUS_BADGE: Record<Resource["status"], string> = {
  AVAILABLE: "🟢 Available",
  MAINTENANCE: "🟡 Maintenance",
  DISABLED: "⚫ Disabled"
};

export function ResourceList() {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .listResources({ q: q || undefined })
        .then(({ resources }) => setResources(resources))
        .catch(() => setError("Could not load resources."));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <section>
      <h1>Resources</h1>
      <input
        className="search-input"
        placeholder="Search by name, landmark, use, or description…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {error && <p className="notice notice-error">{error}</p>}
      {!resources ? (
        <p>Loading resources…</p>
      ) : resources.length === 0 ? (
        <p>No resources match your search.</p>
      ) : (
        <div className="resource-grid">
          {resources.map((r) => (
            <article key={r.id} className="resource-card" data-testid="resource-card">
              {r.imageUrl && <img className="resource-image" src={r.imageUrl} alt={r.name} />}
              <div className="resource-card-header">
                <h2>{r.name}</h2>
                <span className="availability-tag">{STATUS_BADGE[r.status]}</span>
              </div>
              <p className="resource-meta">
                {r.location}
                {r.capacity !== null ? ` · Capacity ${r.capacity}` : ""}
              </p>
              <p className="resource-best-for">{r.bestForUse}</p>
              <p>{r.description}</p>
              {r.facilities.length > 0 && (
                <div className="facility-chips">
                  {r.facilities.map((f) => (
                    <span className="chip" key={f}>
                      {f}
                    </span>
                  ))}
                </div>
              )}
              <div className="resource-card-footer">
                {r.status === "AVAILABLE" ? (
                  <Link className="button" to={`/resources/${r.id}/book`}>
                    Book this room
                  </Link>
                ) : (
                  <span className="notice notice-warning resource-unavailable-note">
                    {r.status === "MAINTENANCE"
                      ? "This resource is currently unavailable."
                      : "This resource is not available for booking."}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
