import { NavLink, Outlet } from "react-router-dom";

export function AdminLayout() {
  return (
    <section>
      <h1>Admin</h1>
      <nav className="admin-nav">
        <NavLink to="/admin" end>
          Dashboard
        </NavLink>
        <NavLink to="/admin/users">Users</NavLink>
        <NavLink to="/admin/bookings">Bookings</NavLink>
        <NavLink to="/admin/resources">Resources</NavLink>
        <NavLink to="/admin/audit-logs">Audit Logs</NavLink>
      </nav>
      <div className="admin-content">
        <Outlet />
      </div>
    </section>
  );
}
