import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useApp } from "./context";
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
      <header className="app-header">
        <div className="brand">
          <NavLink to="/" className="brand-link">
            Booking System
          </NavLink>
        </div>
        <nav className="app-nav">
          <NavLink to="/" end>
            Resources
          </NavLink>
          <NavLink to="/my-bookings">My Bookings</NavLink>
          {isAdmin && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="app-controls">
          <label>
            Timezone
            <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
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
      </header>

      <main className="app-main">
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
