import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.spec.ts",
  outputDir: "work/test-results",
  use: {
    headless: true,
    launchOptions: process.env.MOTORATLAS_CHROME ? { executablePath: process.env.MOTORATLAS_CHROME } : {},
  },
});
