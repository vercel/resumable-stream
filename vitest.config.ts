import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    coverage: {
      reporter: ["text", "json", "html"],
    },
    // Console output settings
    silent: false,
    logHeapUsage: true,
    maxConcurrency: 5,
    reporters: ["default"],
    // Enable all console methods
    allowOnly: false,
  },
});
