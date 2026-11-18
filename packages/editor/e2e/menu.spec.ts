import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { editing, newEntry, openEditor, outline } from "./helpers.js";

const PHOTO = join(import.meta.dirname, "photo.jpg");

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

const lineMenu = (page: Page) => page.getByRole("menu", { name: "Line menu" });

async function openMenu(page: Page, text: string) {
  await page.locator(".node", { has: page.locator(":scope > .row", { hasText: text }) }).locator(":scope > .row > .bullet").click();
  await expect(lineMenu(page)).toBeVisible();
}

test("draft and comment can be switched on and off, and undone", async ({ page }) => {
  await openMenu(page, "Hello, world");
  await lineMenu(page).getByRole("menuitemcheckbox", { name: "Draft (don't publish)" }).click();
  const hello = page.locator(".node", { has: page.locator(":scope > .row", { hasText: "Hello, world" }) });
  await expect(hello).toHaveClass(/draft/);
  await expect(hello.locator(":scope > .row .tag")).toHaveText("Draft");

  await openMenu(page, "Hello, world");
  await lineMenu(page).getByRole("menuitemcheckbox", { name: "Not a draft" }).click();
  await expect(hello).not.toHaveClass(/draft/);

  await openMenu(page, "Edit or delete it");
  await lineMenu(page).getByRole("menuitemcheckbox", { name: "Comment (note to self)" }).click();
  await expect(page.locator(".node.comment")).toHaveCount(1);
  // Undo works from any line being edited (this one has no link to click by mistake).
  await page.locator(".rendered", { hasText: "Hello, world" }).click();
  await expect(editing(page)).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".node.comment")).toHaveCount(0);
});

test("Ctrl-K adds a link at the cursor", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("see  for more");
  for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Add link" });
  await dialog.getByLabel("Address").fill("example.com/porridge");
  await dialog.getByLabel("Text").fill("the recipe");
  await dialog.getByRole("button", { name: "Add link" }).click();
  await expect(editing(page)).toHaveValue("see [the recipe](https://example.com/porridge) for more");
  await expect(editing(page)).toBeFocused();
});

test("a link added from the menu goes at the end of the line", async ({ page }) => {
  await openMenu(page, "Hello, world");
  await lineMenu(page).getByRole("menuitem", { name: "Add link…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add link" });
  await dialog.getByLabel("Address").fill("https://example.com");
  await dialog.getByRole("button", { name: "Add link" }).click();
  await expect(editing(page)).toHaveValue("Hello, world [https://example.com](https://example.com)");
});

test("Copy link copies the entry's permalink", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await newEntry(page);
  await page.keyboard.type("Link to me");
  await page.keyboard.press("Escape");
  await openMenu(page, "Link to me");
  await lineMenu(page).getByRole("menuitem", { name: "Copy link" }).click();
  await expect(page.locator(".toast")).toHaveText("Link copied");
  // The template's (placeholder) site address, the day page, and the time in Europe/London.
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "https://YOUR-USERNAME.github.io/YOUR-REPO/2026/11/18/#a193000",
  );
});

test("days and months can be deleted from their menu", async ({ page }) => {
  await openMenu(page, "18th November");
  page.once("dialog", (d) => {
    expect(d.message()).toBe("Delete 18th November and the 3 lines inside it?");
    void d.accept();
  });
  await lineMenu(page).getByRole("menuitem", { name: "Delete" }).click();
  expect(await outline(page)).toBe("November 2026");
  await openMenu(page, "November 2026");
  await expect(lineMenu(page).getByRole("menuitem", { name: "Add link…" })).toHaveCount(0);
});

test("the menu works from the keyboard", async ({ page }) => {
  await openMenu(page, "Hello, world");
  await expect(lineMenu(page).getByRole("menuitem", { name: "Zoom in" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(lineMenu(page).getByRole("menuitem", { name: "Add link…" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(lineMenu(page)).toBeHidden();
});

test("an image is resized, kept in the browser and shown straight away", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("Breakfast");
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".node", { has: page.locator(":scope > .row textarea") }).locator(":scope > .row > .bullet").click();
  await lineMenu(page).getByRole("menuitem", { name: "Add image…" }).click();
  await (await chooser).setFiles(PHOTO);

  const dialog = page.getByRole("dialog", { name: "Add image" });
  await expect(dialog.locator("img.image-preview")).toBeVisible();
  await dialog.getByLabel("Description").fill("A bowl of porridge");
  await dialog.getByRole("button", { name: "Add image" }).click();

  await expect(editing(page)).toHaveValue("Breakfast ![A bowl of porridge](/images/2026/11/photo-18193000.jpg)");
  await page.keyboard.press("Escape");
  const img = page.locator(".rendered img");
  await expect(img).toHaveAttribute("src", /^blob:/);
  await expect(img).toHaveAttribute("alt", "A bowl of porridge");

  // Stored resized to 2000px wide, as a JPEG.
  const stored = await page.evaluate(
    () =>
      new Promise<{ width: number; height: number; type: string }>((resolve) => {
        const req = indexedDB.open("porridge");
        req.onsuccess = () => {
          const get = req.result.transaction("kv").objectStore("kv").get("image:images/2026/11/photo-18193000.jpg");
          get.onsuccess = async () => {
            const blob = get.result as Blob;
            const bmp = await createImageBitmap(blob);
            resolve({ width: bmp.width, height: bmp.height, type: blob.type });
          };
        };
      }),
  );
  expect(stored).toEqual({ width: 2000, height: 1500, type: "image/jpeg" });

  // Still there after a reload.
  await page.reload();
  await expect(page.locator(".rendered img")).toHaveAttribute("src", /^blob:/);
});
