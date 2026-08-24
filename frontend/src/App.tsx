import { NavLink, Route, Routes } from "react-router-dom";
import { useApp } from "./context";
import { COMMON_TIMEZONES } from "./utils/timezone";
import { ResourceList } from "./pages/ResourceList";
import { BookingPage } from "./pages/BookingPage";
import { MyBookings } from "./pages/MyBookings";
import { AuthPage } from "./pages/AuthPage";

export default function App() {
  const { user, authChecked, logout, timeZone, setTimeZone } = useApp();

  if (!authChecked) {
    return <p style={{ padding: 24 }}>Loading…</p>;
  }

  if (!user) {
    return <AuthPage />;
  }

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
        </Routes>
      </main>
    </div>
  );
}
