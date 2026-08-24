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
    server: {
      deps: {
        external: ["node:sqlite"]
      }
    }
  }
});
