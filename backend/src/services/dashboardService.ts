import type { DatabaseSync } from "node:sqlite";

export interface DashboardSummary {
  totalUsers: number;
  totalResources: number;
  availableResources: number;
  todaysBookings: number;
  upcomingBookings: number;
  cancelledBookings: number;
  mostBookedResource: { id: string; name: string; count: number } | null;
  leastBookedResource: { id: string; name: string; count: number } | null;
}

function count(db: DatabaseSync, sql: string, params: unknown[] = []): number {
  return (db.prepare(sql).get(...(params as [])) as { c: number }).c;
}

export function getDashboardSummary(db: DatabaseSync, now: Date = new Date()): DashboardSummary {
  const totalUsers = count(db, "SELECT COUNT(*) as c FROM users");
  const totalResources = count(db, "SELECT COUNT(*) as c FROM resources");
  const availableResources = count(db, "SELECT COUNT(*) as c FROM resources WHERE status = 'AVAILABLE'");

  const todayStr = now.toISOString().slice(0, 10);
  const todaysBookings = count(
    db,
    "SELECT COUNT(*) as c FROM bookings WHERE status = 'CONFIRMED' AND date(startAt) = ?",
    [todayStr]
  );
  const upcomingBookings = count(
    db,
    "SELECT COUNT(*) as c FROM bookings WHERE status = 'CONFIRMED' AND startAt > ?",
    [now.toISOString()]
  );
  const cancelledBookings = count(db, "SELECT COUNT(*) as c FROM bookings WHERE status = 'CANCELLED'");

  const counts = db
    .prepare(
      `SELECT resources.id as id, resources.name as name, COUNT(bookings.id) as cnt
       FROM resources
       LEFT JOIN bookings ON bookings.resourceId = resources.id
       GROUP BY resources.id
       ORDER BY cnt DESC`
    )
    .all() as unknown as Array<{ id: string; name: string; cnt: number }>;

  const withBookings = counts.filter((r) => r.cnt > 0);
  const mostBookedResource = withBookings.length
    ? { id: withBookings[0].id, name: withBookings[0].name, count: withBookings[0].cnt }
    : null;
  const leastBookedResource = withBookings.length
    ? (() => {
        const least = withBookings[withBookings.length - 1];
        return { id: least.id, name: least.name, count: least.cnt };
      })()
    : null;

  return {
    totalUsers,
    totalResources,
    availableResources,
    todaysBookings,
    upcomingBookings,
    cancelledBookings,
    mostBookedResource,
    leastBookedResource
  };
}
