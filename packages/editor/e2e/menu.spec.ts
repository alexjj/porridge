import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { downloadCurrent, editing, menu, newEntry, openEditor, outline } from "./helpers.js";

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
  // Links need the site's address (no repo is connected here).
  await menu(page, "Blog settings…");
  await page.getByRole("dialog", { name: "Settings" }).getByLabel("Site address").fill("https://blog.example/");
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close" }).click();
  await newEntry(page);
  await page.keyboard.type("Link to me");
  await page.keyboard.press("Escape");
  await openMenu(page, "Link to me");
  await lineMenu(page).getByRole("menuitem", { name: "Copy link" }).click();
  await expect(page.locator(".toast")).toHaveText("Link copied");
  // The site address, the day page, and the time in Europe/London.
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://blog.example/2026/11/18/#a193000");
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
  await expect(lineMenu(page).getByRole("menuitem", { name: "Select…" })).toBeFocused();
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

  await expect(editing(page)).toHaveValue("Breakfast ![A bowl of porridge](/images/2026/11/photo-18193000.webp)");
  await page.keyboard.press("Escape");
  const img = page.locator(".rendered img");
  await expect(img).toHaveAttribute("src", /^blob:/);
  await expect(img).toHaveAttribute("alt", "A bowl of porridge");

  // Stored resized to 2000px wide, as WebP.
  const stored = await page.evaluate(
    () =>
      new Promise<{ width: number; height: number; type: string }>((resolve) => {
        const req = indexedDB.open("porridge");
        req.onsuccess = () => {
          const get = req.result.transaction("kv").objectStore("kv").get("image:images/2026/11/photo-18193000.webp");
          get.onsuccess = async () => {
            const blob = get.result as Blob;
            const bmp = await createImageBitmap(blob);
            resolve({ width: bmp.width, height: bmp.height, type: blob.type });
          };
        };
      }),
  );
  expect(stored).toEqual({ width: 2000, height: 1500, type: "image/webp" });

  // Still there after a reload.
  await page.reload();
  await expect(page.locator(".rendered img")).toHaveAttribute("src", /^blob:/);
});

/** Dispatch a paste of `text` into the focused textarea. */
async function paste(page: Page, text: string) {
  await editing(page).evaluate((ta, t) => {
    const data = new DataTransfer();
    data.setData("text/plain", t);
    ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

test("pasting an address over selected text makes a link", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("try a search engine today");
  await editing(page).evaluate((ta: HTMLTextAreaElement) => ta.setSelectionRange(6, 19)); // "search engine"
  await paste(page, "www.google.com");
  await expect(editing(page)).toHaveValue("try a [search engine](https://www.google.com) today");
  expect(await editing(page).evaluate((ta: HTMLTextAreaElement) => ta.selectionStart)).toBe(45); // just after the link

  // A Markdown link on the clipboard works too, and it's one undo step.
  await editing(page).evaluate((ta: HTMLTextAreaElement) => ta.setSelectionRange(0, 3)); // "try"
  await paste(page, "[docs](https://example.com/docs)");
  await expect(editing(page)).toHaveValue("[try](https://example.com/docs) a [search engine](https://www.google.com) today");
  await page.keyboard.press("Control+z");
  await expect(editing(page)).toHaveValue("try a [search engine](https://www.google.com) today");
});

test("pasting an address with nothing selected just pastes it", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("see ");
  await paste(page, "https://example.com");
  // Not handled by the link paste, so the browser pastes as normal (a synthetic
  // paste event inserts nothing; the line is unchanged and no link was made).
  await expect(editing(page)).toHaveValue("see ");
});

test("an image's description shows as a caption in the editor", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("![A big stack of notebooks](https://example.com/n.jpg)");
  await page.keyboard.press("Escape");
  const caption = page.locator(".rendered .figure .caption");
  await expect(caption).toHaveText("A big stack of notebooks");
  await expect(caption).toHaveAttribute("aria-hidden", "true");
});

test("pasting an image opens the Add image dialog", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("Screenshot: ");
  await editing(page).evaluate(async (ta) => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 200;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#b5622a";
    ctx.fillRect(0, 0, 300, 200);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
    const data = new DataTransfer();
    data.items.add(new File([blob], "image.png", { type: "image/png" }));
    ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const dialog = page.getByRole("dialog", { name: "Add image" });
  await expect(dialog.locator("img.image-preview")).toBeVisible();
  await expect(dialog.getByLabel("Description")).toHaveValue("");
  await dialog.getByLabel("Description").fill("An orange rectangle");
  await dialog.getByRole("button", { name: "Add image" }).click();
  // A small PNG the WebP doesn't beat is kept as it is; otherwise it's WebP.
  await expect(editing(page)).toHaveValue(/^Screenshot: !\[An orange rectangle\]\(\/images\/2026\/11\/image-18193000\.(webp|png)\)$/);
});

test("Children as bullets is set from the menu and shows in the preview", async ({ page }) => {
  await openMenu(page, "Hello, world");
  await lineMenu(page).getByRole("menuitemcheckbox", { name: "Children as bullets" }).click();
  const hello = page.locator(".node", { has: page.locator(":scope > .row", { hasText: "Hello, world" }) });
  await expect(hello.locator(":scope > .row .tag")).toHaveText("Bullets");

  await page.getByRole("tab", { name: "Preview" }).click();
  await page.getByText("This is the first post").click({ position: { x: 5, y: 5 } });
  await expect(editing(page)).toBeFocused();
  const frame = page.frameLocator(".preview iframe");
  await expect(frame.locator("article.entry ul li").first()).toContainText("This is the first post");

  // One undo step.
  await page.keyboard.press("Control+z");
  await expect(hello.locator(":scope > .row .tag")).toHaveCount(0);
  await expect(frame.locator("article.entry ul")).toHaveCount(0);
});

test("the site's colours are chosen in Blog settings and show in the preview", async ({ page }) => {
  await page.getByRole("tab", { name: "Preview" }).click();
  const body = page.frameLocator(".preview iframe").locator("body");
  const bg = () => body.evaluate((b) => getComputedStyle(b).backgroundColor);
  await expect.poll(bg).toBe("rgb(251, 250, 246)");

  await menu(page, "Blog settings…");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByRole("radio", { name: /Porridge/ })).toBeChecked();
  await dialog.getByText("Nord", { exact: true }).click();
  await expect(dialog.getByRole("radio", { name: /Nord/ })).toBeChecked();
  await expect.poll(bg).toBe("rgb(236, 239, 244)");

  // Custom starts from the colours showing now.
  await dialog.getByText("Custom", { exact: true }).click();
  const light = dialog.getByLabel("Background, light, as text");
  await expect(light).toHaveValue("#eceff4");
  await expect(dialog.getByLabel("Background, dark, as text")).toHaveValue("#2e3440");
  await light.fill("#ff0000");
  await light.press("Enter");
  await expect.poll(bg).toBe("rgb(255, 0, 0)");
  // Anything that isn't a colour is refused.
  await light.fill("red; } body { display: none");
  await light.press("Enter");
  await expect(light).toHaveValue("#ff0000");

  // Back to the default.
  await dialog.getByText("Porridge", { exact: true }).click();
  await expect.poll(bg).toBe("rgb(251, 250, 246)");
});

test("outside links are added to the navigation in Blog settings and can be moved", async ({ page }) => {
  await menu(page, "Blog settings…");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const items = dialog.locator(".nav-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("About");
  await expect(items.nth(1)).toContainText("Archive");

  await dialog.getByRole("button", { name: "Add a link" }).click();
  await expect(dialog.getByLabel("Link 2 label")).toBeFocused();
  await page.keyboard.type("My photos");
  await dialog.getByLabel("Link 2 address").fill("photos.example");
  await expect(dialog.locator(".nav-item .field-problem")).toHaveText(/^Not a web address/);
  await dialog.getByLabel("Link 2 address").fill("https://photos.example/");
  await expect(dialog.locator(".nav-item .field-problem")).toHaveCount(0);
  await expect(dialog.getByLabel("Link 2 label")).toHaveValue("My photos");

  // To the top, then the archive above it.
  await dialog.getByRole("button", { name: "Move My photos up" }).click();
  await expect(dialog.getByLabel("Link 1 label")).toHaveValue("My photos");
  await dialog.getByRole("button", { name: "Move Archive up" }).click();
  await dialog.getByRole("button", { name: "Move Archive up" }).click();
  await expect(items.nth(0)).toContainText("Archive");
  await expect(dialog.getByLabel("Link 2 label")).toHaveValue("My photos");
  await expect(items.nth(2)).toContainText("About");
  await expect(dialog.getByRole("button", { name: "Move Archive up" })).toBeDisabled();

  await dialog.getByRole("button", { name: "Remove My photos" }).click();
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Archive");
});

test("the site icon is picked in Blog settings", async ({ page }) => {
  await menu(page, "Blog settings…");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const icons = dialog.getByRole("radiogroup", { name: "Site icon" });
  await expect(icons.getByRole("radio", { name: "🥣" })).toHaveAttribute("aria-checked", "true");
  await icons.getByRole("radio", { name: "🦉" }).click();
  await expect(icons.getByRole("radio", { name: "🦉" })).toHaveAttribute("aria-checked", "true");
  await expect(icons.getByRole("radio", { name: "🥣" })).toHaveAttribute("aria-checked", "false");

  const other = dialog.getByLabel("Or any other emoji");
  await other.fill("🦔🦔");
  await expect(dialog.getByText("Just one emoji.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Use it" })).toBeDisabled();
  await other.fill("🦔");
  await other.press("Enter");
  // A choice that isn't in the list joins the end of it.
  await expect(icons.getByRole("radio", { name: "🦔" })).toHaveAttribute("aria-checked", "true");

  // Still chosen when the settings are opened again.
  await dialog.getByRole("button", { name: "Close" }).click();
  await menu(page, "Blog settings…");
  await expect(icons.getByRole("radio", { name: "🦔" })).toHaveAttribute("aria-checked", "true");
});

test("an OPML file is imported as a page", async ({ page }) => {
  await page.getByRole("button", { name: "New page" }).click();
  const dialog = page.getByRole("dialog", { name: "New page" });
  const input = dialog.getByLabel("Or import an OPML file");

  await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("just text") });
  await expect(dialog.getByRole("alert")).toHaveText(/^notes\.txt isn't an OPML file/);

  await input.setInputFiles({
    name: "books.opml",
    mimeType: "text/xml",
    buffer: Buffer.from(`<?xml version="1.0"?>
<opml version="2.0"><head><title>Books I liked</title></head><body>
  <outline text="Fiction" _note="Mostly novels"><outline text="Middlemarch"/></outline>
</body></opml>`),
  });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Files" }).getByRole("button", { name: "Books I liked", exact: true })).toBeVisible();
  expect(await outline(page)).toBe("Fiction\n  Mostly novels\n  Middlemarch");

  const { name, text } = await downloadCurrent(page);
  expect(name).toBe("books-i-liked.opml");
  expect(text).toContain("<porridge:inNav>true</porridge:inNav>");
});
