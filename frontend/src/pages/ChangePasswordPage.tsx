import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { PasswordInput } from "../components/PasswordInput";
import { useApp } from "../context";

export function ChangePasswordPage() {
  const { user, refreshUser } = useApp();
  const navigate = useNavigate();
  const forced = Boolean(user?.passwordChangeRequired);

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword(
        currentPassword,
        newPassword,
        confirmPassword,
        forced ? { name, email } : undefined
      );
      await refreshUser();
      navigate(user?.role === "ADMIN" ? "/admin" : "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>{forced ? "Set a new password" : "Change password"}</h1>
        {forced && (
          <p className="notice notice-warning">
            This is your first login with the default admin password. Set your own name, email, and password before
            continuing — you'll use these to log in from now on.
          </p>
        )}
        <form className="booking-form" onSubmit={handleSubmit}>
          {forced && (
            <>
              <label>
                Name
                <input
                  type="text"
                  data-testid="name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  data-testid="email-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </label>
            </>
          )}
          <label>
            Current password
            <PasswordInput
              testId="current-password-input"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            New password
            <PasswordInput
              testId="new-password-input"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label>
            Re-enter new password
            <PasswordInput
              testId="confirm-new-password-input"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          {error && (
            <p className="notice notice-error" data-testid="change-password-error">
              {error}
            </p>
          )}
          <button type="submit" className="button" data-testid="change-password-submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save new password"}
          </button>
        </form>
      </div>
    </div>
  );
}
