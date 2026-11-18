// Milestone 5's goal: posting with a photo from a phone is comfortable.
// Runs in Chromium with phone emulation (touch, small screen); real iOS Safari
// and Android Chrome still need checking by hand.

import { join } from "node:path";
import { devices, expect, test, type Page } from "@playwright/test";
import { fakeGitHub, status } from "./github-helpers.js";
import { editing, openEditor, outline } from "./helpers.js";

const PHOTO = join(import.meta.dirname, "photo.jpg");

const { defaultBrowserType: _, ...pixel } = devices["Pixel 7"];
test.use({ ...pixel });

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Editing" });

async function connectOnPhone(page: Page) {
  await page.getByRole("button", { name: "Connect GitHub" }).tap();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByLabel("Repository").fill("me/blog");
  await dialog.getByLabel("Token").fill("good-token");
  page.once("dialog", (d) => void d.accept());
  await dialog.getByRole("button", { name: "Connect" }).tap();
  await expect(status(page)).toHaveText("Saved to GitHub");
}

/** Width and height of an image, decoded by the browser. */
async function imageSize(page: Page, bytes: Buffer): Promise<{ width: number; height: number; webp: boolean }> {
  return page.evaluate(async (b64) => {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([raw]));
    const magic = String.fromCharCode(...raw.slice(0, 4)) + String.fromCharCode(...raw.slice(8, 12));
    return { width: bmp.width, height: bmp.height, webp: magic === "RIFFWEBP" };
  }, bytes.toString("base64"));
}

test("writing and publishing a post with a photo, by tapping", async ({ page }) => {
  const fake = await fakeGitHub(page);
  await openEditor(page);
  await connectOnPhone(page);

  await page.getByRole("button", { name: "New entry" }).tap();
  await expect(toolbar(page)).toBeVisible();
  await page.keyboard.type("Porridge season");
  await page.keyboard.press("Enter");

  // The toolbar indents without the keyboard losing focus.
  await toolbar(page).getByRole("button", { name: "Indent" }).tap();
  await expect(editing(page)).toBeFocused();
  await page.keyboard.type("Cinnamon this time.");

  const chooser = page.waitForEvent("filechooser");
  await toolbar(page).getByRole("button", { name: "Add image" }).tap();
  await (await chooser).setFiles(PHOTO);
  const dialog = page.getByRole("dialog", { name: "Add image" });
  await dialog.getByLabel("Description").fill("A bowl of porridge");
  await dialog.getByRole("button", { name: "Add image" }).tap();
  await expect(editing(page)).toHaveValue("Cinnamon this time. ![A bowl of porridge](/images/2026/11/photo-18193000.webp)");
  await expect(toolbar(page)).toBeVisible();

  await toolbar(page).getByRole("button", { name: "Done" }).tap();
  await expect(toolbar(page)).toBeHidden();
  await expect(status(page)).toHaveText("2 unsaved changes");

  await page.getByRole("button", { name: "Publish" }).tap();
  await expect(status(page)).toHaveText("Published");

  expect(fake.lastMessage()).toBe("Publish: blog/2026, 1 image");
  const year = fake.read("blog/2026.opml")!;
  expect(year).toContain(`<outline text="Porridge season" created="Wed, 18 Nov 2026 19:30:00 GMT">`);
  // (It was briefly an entry before being indented, so it kept a created time.)
  expect(year).toMatch(/<outline text="Cinnamon this time\. !\[A bowl of porridge\]\(\/images\/2026\/11\/photo-18193000\.webp\)"[^>]*\/>/);
  const photo = fake.readBytes("images/2026/11/photo-18193000.webp")!;
  expect(await imageSize(page, photo)).toEqual({ width: 2000, height: 1500, webp: true });
  expect(photo.length).toBeLessThan(150_000); // the 4032×3024 original, compressed
  expect(fake.runs.map((r) => r.conclusion)).toEqual(["success"]);
  // Uploaded, so no longer waiting in the browser.
  await expect(status(page)).toHaveText("Published");
  await expect(page.locator(".rendered img")).toBeVisible();
});

test("the line menu is a bottom sheet on a phone", async ({ page }) => {
  await openEditor(page);
  await page.locator(".node", { has: page.locator(":scope > .row", { hasText: "Hello, world" }) }).locator(":scope > .row > .bullet").tap();
  const sheet = page.getByRole("menu", { name: "Line menu" });
  await expect(sheet).toHaveClass(/sheet/);
  const box = (await sheet.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(Math.round(box.y + box.height)).toBe(viewport.height);

  await sheet.getByRole("menuitemcheckbox", { name: "Draft (don't publish)" }).tap();
  await expect(sheet).toBeHidden();
  await expect(page.locator(".node.draft")).toHaveCount(1);
});

test("the toolbar moves lines and opens the line menu", async ({ page }) => {
  await openEditor(page);
  await page.getByText("Edit or delete it").tap();
  await expect(toolbar(page)).toBeVisible();
  await toolbar(page).getByRole("button", { name: "Move up" }).tap();
  expect(await outline(page)).toContain("      Edit or delete it, then write your own.|\n      This is the first post");
  await toolbar(page).getByRole("button", { name: "Outdent" }).tap();
  expect(await outline(page)).toContain("    Edit or delete it, then write your own.|");
  await toolbar(page).getByRole("button", { name: "Undo" }).tap();
  expect(await outline(page)).toContain("      Edit or delete it, then write your own.");
  await toolbar(page).getByRole("button", { name: "Line menu" }).tap();
  await expect(page.getByRole("menu", { name: "Line menu" })).toBeVisible();
  await expect(toolbar(page)).toBeHidden();
});

test("nothing scrolls sideways on a phone", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "New entry" }).tap();
  await page.keyboard.type("A long line ".repeat(20));
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(width);
});

test("selecting several lines with taps, then indenting them", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "New entry" }).tap();
  await page.keyboard.type("first");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second");
  await page.keyboard.press("Enter");
  await page.keyboard.type("third");
  await toolbar(page).getByRole("button", { name: "Done" }).tap();

  const bullet = (text: string) =>
    page.locator(".node", { has: page.locator(":scope > .row > .text", { hasText: new RegExp(`^${text}$`) }) }).locator(":scope > .row > .bullet");
  await bullet("second").tap();
  await page.getByRole("menu", { name: "Line menu" }).getByRole("menuitem", { name: "Select…" }).tap();
  await page.locator(".rendered", { hasText: /^third$/ }).tap();

  const selectionBar = page.getByRole("toolbar", { name: "Selected lines" });
  await expect(selectionBar).toContainText("2 selected");
  await selectionBar.getByRole("button", { name: "Indent" }).tap();
  expect(await outline(page)).toContain("    first\n      second\n      third\n");
  await selectionBar.getByRole("button", { name: "Done" }).tap();
  await expect(selectionBar).toBeHidden();
});
