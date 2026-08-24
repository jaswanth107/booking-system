import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Resource } from "../types";

export function ResourceList() {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listResources()
      .then(({ resources }) => setResources(resources))
      .catch(() => setError("Could not load resources."));
  }, []);

  if (error) return <p className="notice notice-error">{error}</p>;
  if (!resources) return <p>Loading resources…</p>;

  return (
    <section>
      <h1>Resources</h1>
      <div className="resource-grid">
        {resources.map((r) => (
          <article key={r.id} className="resource-card" data-testid="resource-card">
            <h2>{r.name}</h2>
            <p className="resource-meta">
              {r.location} · Capacity {r.capacity}
            </p>
            <p>{r.description}</p>
            <Link className="button" to={`/resources/${r.id}/book`}>
              Book this room
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
