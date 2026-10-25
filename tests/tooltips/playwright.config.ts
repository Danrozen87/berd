import { defineConfig } from "@playwright/test";
import base from "../theme-contrast/playwright.config";
const server = base.webServer;
if (!server || Array.isArray(server))
  throw new Error("Expected the shared UI fixture server");
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "tooltip.spec.ts",
  outputDir: "../../test-results/tooltips",
  webServer: {
    ...server,
    url: "http://127.0.0.1:15427/tests/tooltips/fixture.html",
  },
});
