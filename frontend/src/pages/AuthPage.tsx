import { useState } from "react";
import { ApiError } from "../api/client";
import { useApp } from "../context";

type Mode = "new" | "existing";

export function AuthPage() {
  const { login, signup } = useApp();
  const [mode, setMode] = useState<Mode>("new");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "new") {
        await signup(name, email, password);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword("");
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Booking System</h1>

        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`tab ${mode === "new" ? "tab-active" : ""}`}
            aria-selected={mode === "new"}
            data-testid="toggle-new-user"
            onClick={() => switchMode("new")}
          >
            New user
          </button>
          <button
            type="button"
            role="tab"
            className={`tab ${mode === "existing" ? "tab-active" : ""}`}
            aria-selected={mode === "existing"}
            data-testid="toggle-existing-user"
            onClick={() => switchMode("existing")}
          >
            Existing user
          </button>
        </div>

        <form className="booking-form" onSubmit={handleSubmit}>
          {mode === "new" && (
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
          )}

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

          <label>
            {mode === "new" ? "Create a password" : "Password"}
            <input
              type="password"
              data-testid="password-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "new" ? "new-password" : "current-password"}
              minLength={mode === "new" ? 8 : undefined}
              required
            />
          </label>
          {mode === "new" && <p className="resource-meta">At least 8 characters.</p>}

          {error && (
            <p className="notice notice-error" data-testid="auth-error">
              {error}
            </p>
          )}

          <button type="submit" className="button" data-testid="auth-submit" disabled={submitting}>
            {submitting ? "Please wait…" : mode === "new" ? "Create account" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
