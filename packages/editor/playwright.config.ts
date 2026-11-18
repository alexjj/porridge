import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { trace: "off" },
  webServer: [
    {
      // Built in e2e mode: the starter blog is the small, fixed one in e2e/starter.
      command: "npm run build:e2e && npx vite preview --port 4173 --strictPort",
      port: 4173,
      reuseExistingServer: !process.env.CI,
      cwd: import.meta.dirname,
    },
    {
      // A normal build, to check the real starter blog people see first.
      command: "npx vite build --outDir dist-prod && npx vite preview --outDir dist-prod --port 4174 --strictPort",
      port: 4174,
      reuseExistingServer: !process.env.CI,
      cwd: import.meta.dirname,
    },
  ],
  projects: [
    {
      name: "chromium",
      testIgnore: /starter\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4173" },
    },
    {
      name: "starter",
      testMatch: /starter\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4174" },
    },
  ],
});
