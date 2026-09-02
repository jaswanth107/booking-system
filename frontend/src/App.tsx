import { useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useApp } from "./context";
import type { User } from "./types";
import { COMMON_TIMEZONES } from "./utils/timezone";
import { ResourceList } from "./pages/ResourceList";
import { BookingPage } from "./pages/BookingPage";
import { MyBookings } from "./pages/MyBookings";
import { AuthPage } from "./pages/AuthPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { AdminUsers } from "./pages/admin/AdminUsers";
import { AdminBookings } from "./pages/admin/AdminBookings";
import { AdminResources } from "./pages/admin/AdminResources";
import { AdminAuditLogs } from "./pages/admin/AdminAuditLogs";

export default function App() {
  const { user, authChecked, logout, timeZone, setTimeZone } = useApp();

  if (!authChecked) {
    return <p style={{ padding: 24 }}>Loading…</p>;
  }

  // Logged out: only the auth screens are reachable. /reset-password must
  // work even with no session (the link comes from outside the app).
  if (!user) {
    return (
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/forgot-password" element={<AuthPage initialMode="forgot" />} />
        <Route path="*" element={<AuthPage />} />
      </Routes>
    );
  }

  // Forced first-login password change (the default admin account, or any
  // account an admin resets into this state) blocks everything else until done.
  if (user.passwordChangeRequired) {
    return <ChangePasswordPage />;
  }

  const isAdmin = user.role === "ADMIN";

  return (
    <div className="app">
      <Sidebar isAdmin={isAdmin} user={user} logout={logout} />

      <main className="app-main">
        <div className="app-topbar">
          <label className="timezone-control">
            Timezone
            <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Routes>
          <Route path="/" element={<ResourceList />} />
          <Route path="/resources/:resourceId/book" element={<BookingPage />} />
          <Route path="/my-bookings" element={<MyBookings />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />

          {isAdmin ? (
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="bookings" element={<AdminBookings />} />
              <Route path="resources" element={<AdminResources />} />
              <Route path="audit-logs" element={<AdminAuditLogs />} />
              <Route path="change-password" element={<ChangePasswordPage />} />
            </Route>
          ) : (
            <Route path="/admin/*" element={<Navigate to="/" replace />} />
          )}
        </Routes>
      </main>
    </div>
  );
}

function Sidebar({ isAdmin, user, logout }: { isAdmin: boolean; user: User; logout: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="sidebar-toggle"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span />
        <span />
        <span />
      </button>

      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} />}

      <aside className={`app-sidebar ${open ? "app-sidebar-open" : ""}`}>
        <div className="brand">
          <NavLink to="/" className="brand-link">
            Booking System
          </NavLink>
        </div>

        <nav className="app-nav" onClick={() => setOpen(false)}>
          <NavLink to="/" end>
            Resources
          </NavLink>
          <NavLink to="/my-bookings">My Bookings</NavLink>

          {isAdmin && (
            <div className="app-nav-section">
              <span className="app-nav-section-label">Admin</span>
              <div className="app-nav-sub">
                <NavLink to="/admin" end>
                  Dashboard
                </NavLink>
                <NavLink to="/admin/users">Users</NavLink>
                <NavLink to="/admin/bookings">Bookings</NavLink>
                <NavLink to="/admin/resources">Resources</NavLink>
                <NavLink to="/admin/audit-logs">Audit Logs</NavLink>
              </div>
            </div>
          )}
        </nav>

        <div className="app-controls">
          <div className="account-controls">
            <span className="resource-meta" data-testid="current-user-name">
              {user.name}
              {isAdmin && <span className="badge badge-admin">ADMIN</span>}
            </span>
            <button className="button button-secondary" data-testid="logout-button" onClick={logout}>
              Log out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
