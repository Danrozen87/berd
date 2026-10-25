import { defineConfig } from "@playwright/test";
import base from "../theme-contrast/playwright.config";
const server = base.webServer;
if (!server || Array.isArray(server))
  throw new Error("Expected the shared UI fixture server");
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "sidebar.spec.ts",
  outputDir: "../../test-results/sidebar-motion",
  webServer: {
    ...server,
    command: `VITE_AUTH_GATE=0 VITE_BYO_KEY_PROVIDERS=1 VITE_MANAGED_CONNECTIONS=0 ${server.command}`,
    url: "http://127.0.0.1:15427/",
  },
});
