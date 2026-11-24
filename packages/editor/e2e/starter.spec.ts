// The real starter blog (template/), as someone sees it on a first visit.
// Runs against a normal build of the editor (the other tests use e2e/starter).

import { expect, test } from "@playwright/test";
import { connected, fakeGitHub, status } from "./github-helpers.js";
import { openEditor, openFile } from "./helpers.js";

test("a first visit shows the example blog, images included", async ({ page }) => {
  await openEditor(page);
  await expect(page.locator(".rendered", { hasText: /^Welcome to Porridge$/ })).toBeVisible();
  await expect(page.locator(".node.month > .row .label")).toHaveText(["November 2026", "October 2026"]);

  // The images are bundled with the editor, so they load before any repo is connected.
  const img = page.locator(".rendered img").first();
  await expect(img).toHaveAttribute("alt", "A bowl of porridge with a spoonful of cinnamon");
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator(".rendered .caption").first()).toHaveText("A bowl of porridge with a spoonful of cinnamon");

  // …and in the preview.
  await page.locator(".rendered", { hasText: /^Welcome to Porridge$/ }).click();
  await page.getByRole("tab", { name: "Preview" }).click();
  const previewImg = page.frameLocator(".preview iframe").locator("img").first();
  await expect.poll(() => previewImg.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);

  await openFile(page, "About");
  await expect(page.locator(".rendered", { hasText: /^Elsewhere$/ })).toBeVisible();
});

test("connecting to an empty repository uploads the example blog with its images", async ({ page }) => {
  const fake = await fakeGitHub(page, { "README.md": "# my blog" });
  await openEditor(page);
  await connected(page);
  await expect(status(page)).toHaveText("Saved to GitHub");
  expect(fake.paths()).toEqual([
    "README.md",
    "blog.opml",
    "blog/2026.opml",
    "images/2026/10/side-bowl.webp",
    "images/2026/11/porridge-bowl.webp",
    "pages/about.opml",
  ]);
  const bytes = fake.readBytes("images/2026/11/porridge-bowl.webp")!;
  expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
});
