import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, clearToken, getToken, setToken } from "./api/client";
import type { User } from "./types";
import { DEVICE_TIMEZONE } from "./utils/timezone";

interface AppContextValue {
  user: User | null;
  authChecked: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, confirmPassword: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  timeZone: string;
  setTimeZone: (tz: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [timeZone, setTimeZoneState] = useState<string>(
    localStorage.getItem("booking-system:timeZone") ?? DEVICE_TIMEZONE
  );

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setAuthChecked(true);
      return;
    }
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch((err) => {
        if (err instanceof ApiError) clearToken();
      })
      .finally(() => setAuthChecked(true));
  }, []);

  async function login(email: string, password: string) {
    const { user, token } = await api.login(email, password);
    setToken(token);
    setUser(user);
  }

  async function signup(name: string, email: string, password: string, confirmPassword: string) {
    const { user, token } = await api.signup(name, email, password, confirmPassword);
    setToken(token);
    setUser(user);
  }

  function logout() {
    api.logout().catch(() => {});
    clearToken();
    setUser(null);
  }

  async function refreshUser() {
    const { user } = await api.me();
    setUser(user);
  }

  function setTimeZone(tz: string) {
    localStorage.setItem("booking-system:timeZone", tz);
    setTimeZoneState(tz);
  }

  return (
    <AppContext.Provider value={{ user, authChecked, login, signup, logout, refreshUser, timeZone, setTimeZone }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
