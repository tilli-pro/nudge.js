import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/live.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
