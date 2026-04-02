import { defineConfig } from "vitest/config";
import { config } from "dotenv";

config({ path: ".env" });

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.integration.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
});
