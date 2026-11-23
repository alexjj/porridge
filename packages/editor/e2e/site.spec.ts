// The published site in a browser: the sample blog, built and served through
// request interception (no web server needed).

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { buildToDirectory } from "@porridge/build";

const SITE = "http://site.test/";
let out = "";

test.beforeAll(async () => {
  out = join(mkdtempSync(join(tmpdir(), "porridge-site-")), "site");
  await buildToDirectory(join(import.meta.dirname, "../../../fixtures/sample-blog"), out, { baseUrl: SITE });
});

test.beforeEach(async ({ page }) => {
  await page.route(`${SITE}**`, (route) => {
    let path = join(out, decodeURIComponent(new URL(route.request().url()).pathname));
    if (path.endsWith("/")) path = join(path, "index.html");
    if (!existsSync(path)) return route.fulfill({ status: 404, body: "Not found" });
    const type = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg" }[extname(path)];
    return route.fulfill({ path, contentType: type });
  });
});

test("clicking an image opens it full size, with its caption", async ({ page }) => {
  await page.goto(`${SITE}2026/11/18/`);
  const img = page.locator("main img").first();
  await expect(img).toHaveClass(/zoomable/);
  await img.click();
  const box = page.getByRole("dialog", { name: "Image" });
  await expect(box).toBeVisible();
  await expect(box.locator("img")).toHaveAttribute("src", `${SITE}images/2026/11/porridge.jpg`);
  await expect(box.locator("figcaption")).toHaveText("A bowl of porridge");

  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
  await expect(img).toBeFocused();

  // Keyboard: Enter opens it, a click anywhere closes it.
  await page.keyboard.press("Enter");
  await expect(box).toBeVisible();
  await box.click();
  await expect(box).toBeHidden();
});

test("pages without images load the script without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${SITE}about/`);
  await expect(page.locator("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a video fills the width of the column at 16:9", async ({ page }) => {
  // The player itself comes from YouTube; only the layout matters here.
  await page.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ status: 200, body: "<html></html>", contentType: "text/html" }));
  await page.goto(`${SITE}2026/11/18/`);
  const column = (await page.locator("main").evaluate((m) => {
    const cs = getComputedStyle(m);
    return m.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  })) as number;
  const box = (await page.locator(".video iframe").boundingBox())!;
  expect(Math.round(box.width)).toBe(Math.round(column));
  expect(box.height / box.width).toBeCloseTo(9 / 16, 2);
  // The stylesheet and script are fingerprinted, so a changed theme is never served stale.
  await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute("href", /\/style\.css\?v=[0-9a-f]{8}$/);
  await expect(page.locator("script[src*='porridge.js']")).toHaveAttribute("src", /\/porridge\.js\?v=[0-9a-f]{8}$/);
});

test("a video is full width on a phone too", async ({ page }) => {
  await page.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ status: 200, body: "<html></html>", contentType: "text/html" }));
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${SITE}2026/11/18/`);
  const box = (await page.locator(".video iframe").boundingBox())!;
  expect(box.width).toBeGreaterThan(300);
  expect(box.height / box.width).toBeCloseTo(9 / 16, 2);
});
