import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Vite doesn't yet recognize node:sqlite as a builtin (it's still
    // experimental in Node), so it tries to resolve it as an npm package
    // unless we tell it explicitly to treat it as external.
    conditions: ["node"]
  },
  ssr: {
    external: ["node:sqlite"]
  },
  test: {
    environment: "node",
    globals: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
    // node:sqlite is still somewhat experimental; running every test file in
    // its own worker fork occasionally crashed one under load. Pinning
    // everything to a single worker is more stable and barely slower given
    // fileParallelism is already off.
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
    isolate: false,
    server: {
      deps: {
        external: ["node:sqlite"]
      }
    }
  }
});
