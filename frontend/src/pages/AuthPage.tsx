import { useState } from "react";
import { api, ApiError } from "../api/client";
import { useApp } from "../context";
import { PasswordInput } from "../components/PasswordInput";

type Mode = "new" | "existing" | "forgot";

export function AuthPage({ initialMode = "new" }: { initialMode?: Mode }) {
  const { login, signup } = useApp();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "new") {
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          return;
        }
        await signup(name, email, password, confirmPassword);
      } else if (mode === "existing") {
        await login(email, password);
      } else {
        setForgotMessage(null);
        const res = await api.forgotPassword(email);
        setForgotMessage(res.message);
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
    setForgotMessage(null);
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Booking System</h1>

        {mode !== "forgot" && (
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
        )}

        {mode === "forgot" ? (
          <>
            <p className="resource-meta" style={{ marginTop: 12 }}>
              Enter your account email and we'll send a password reset link.
            </p>
            <form className="booking-form" onSubmit={handleSubmit}>
              <label>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              {forgotMessage && <p className="notice notice-success">{forgotMessage}</p>}
              {error && <p className="notice notice-error">{error}</p>}
              <button type="submit" className="button" disabled={submitting}>
                {submitting ? "Sending…" : "Send reset link"}
              </button>
              <button type="button" className="link-button" onClick={() => switchMode("existing")}>
                Back to login
              </button>
            </form>
          </>
        ) : (
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
              <PasswordInput
                testId="password-input"
                value={password}
                onChange={setPassword}
                autoComplete={mode === "new" ? "new-password" : "current-password"}
                minLength={mode === "new" ? 8 : undefined}
                required
              />
            </label>
            {mode === "new" && (
              <>
                <p className="resource-meta">At least 8 characters.</p>
                <label>
                  Confirm password
                  <PasswordInput
                    testId="confirm-password-input"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
              </>
            )}

            {mode === "existing" && (
              <button type="button" className="link-button" onClick={() => switchMode("forgot")}>
                Forgot password?
              </button>
            )}

            {error && (
              <p className="notice notice-error" data-testid="auth-error">
                {error}
              </p>
            )}

            <button type="submit" className="button" data-testid="auth-submit" disabled={submitting}>
              {submitting ? "Please wait…" : mode === "new" ? "Create account" : "Log in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
