import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "__tests__/live.test.ts"],
    environment: "node",
  },
});
