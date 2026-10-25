import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "contrast.spec.ts",
  outputDir: "../../test-results/theme-contrast",
  timeout: 30_000,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:15427", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "webkit", use: devices["Desktop Safari"] },
  ],
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 15427 --strictPort",
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    url: "http://127.0.0.1:15427/tests/theme-contrast/fixture.html",
    reuseExistingServer: false,
  },
});
