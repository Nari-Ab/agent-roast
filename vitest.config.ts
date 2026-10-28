import { defineConfig } from "vitest/config";

export default defineConfig({
  // Disposable target repositories can contain intentionally broken *.test.ts.
  // Execute only this project's tests, even when another verification is running.
  test: { include: ["tests/**/*.test.ts"] },
});
