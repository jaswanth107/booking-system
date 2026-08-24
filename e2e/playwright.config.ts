import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BACKEND_PORT = 4100;
const FRONTEND_PORT = 5180;
const DB_PATH = path.resolve(__dirname, "..", "backend", "data-e2e.sqlite");

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: [
    {
      command: "npm run e2e:reset-and-serve",
      cwd: path.resolve(__dirname, "..", "backend"),
      env: { DB_PATH, PORT: String(BACKEND_PORT) },
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: `npx vite --port ${FRONTEND_PORT} --strictPort`,
      cwd: path.resolve(__dirname, "..", "frontend"),
      env: { VITE_API_PROXY_TARGET: `http://localhost:${BACKEND_PORT}` },
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000
    }
  ]
});
