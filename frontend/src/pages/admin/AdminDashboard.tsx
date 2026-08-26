import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { DashboardSummary } from "../../types";

const CARDS: Array<{ key: keyof DashboardSummary; label: string }> = [
  { key: "totalUsers", label: "Total Users" },
  { key: "totalResources", label: "Total Resources" },
  { key: "availableResources", label: "Available Resources" },
  { key: "todaysBookings", label: "Today's Bookings" },
  { key: "upcomingBookings", label: "Upcoming Bookings" },
  { key: "cancelledBookings", label: "Cancelled Bookings" }
];

export function AdminDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .dashboard()
      .then(setSummary)
      .catch(() => setError("Could not load dashboard."));
  }, []);

  if (error) return <p className="notice notice-error">{error}</p>;
  if (!summary) return <p>Loading…</p>;

  return (
    <div>
      <div className="stat-grid">
        {CARDS.map((c) => (
          <div className="stat-card" key={c.key}>
            <div className="stat-value">{summary[c.key] as number}</div>
            <div className="stat-label">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="resource-grid" style={{ marginTop: 20 }}>
        <div className="resource-card">
          <h2>Most booked resource</h2>
          <p>{summary.mostBookedResource ? `${summary.mostBookedResource.name} (${summary.mostBookedResource.count})` : "No bookings yet."}</p>
        </div>
        <div className="resource-card">
          <h2>Least booked resource</h2>
          <p>{summary.leastBookedResource ? `${summary.leastBookedResource.name} (${summary.leastBookedResource.count})` : "No bookings yet."}</p>
        </div>
      </div>
    </div>
  );
}
