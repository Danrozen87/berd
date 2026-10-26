import { defineConfig } from "@playwright/test";
import base from "../sidebar-motion/playwright.config";
const server = base.webServer;
if (!server || Array.isArray(server))
  throw new Error("Expected the shared UI fixture server");
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "canvas.spec.ts",
  outputDir: "../../test-results/canvas-motion",
  webServer: {
    ...server,
    // Exercise the production renderer: dev-only onboarding changes this scene.
    command:
      "NODE_OPTIONS=--max-old-space-size=4096 VITE_AUTH_GATE=0 VITE_BYO_KEY_PROVIDERS=1 VITE_ENVIRONMENT=development VITE_MANAGED_CONNECTIONS=0 VITE_UPDATER_ENABLED=false pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 15427 --strictPort",
  },
});
