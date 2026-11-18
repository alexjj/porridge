import { expect, test } from "@playwright/test";
import { loadSite, parseOpml, type ContentSource } from "@porridge/core";
import { downloadCurrent, menu, newEntry, openEditor, openFile, outline } from "./helpers.js";

test("work is kept in the browser across reloads", async ({ page }) => {
  await openEditor(page);
  await newEntry(page);
  await page.keyboard.type("Still here after a reload");
  await page.getByText("Hello, world").click();
  await page.keyboard.press("Control+ArrowUp");
  await expect(page.getByText("Saved in this browser")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Still here after a reload")).toBeVisible();
  // Collapse state is remembered too.
  expect(await outline(page)).toContain("    Hello, world [+]");
});

test("the preview shows the day being edited", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("tab", { name: "Preview" }).click();
  await newEntry(page);
  await page.keyboard.type("Live **preview**");
  const frame = page.frameLocator(".preview iframe");
  await expect(frame.locator("article.entry").first()).toContainText("Live preview");
  await expect(frame.locator("article.entry strong")).toHaveText("preview");
  await expect(page.locator(".preview-label")).toHaveText("Wednesday 18th November 2026");
});

test("pages are edited the same way", async ({ page }) => {
  await openEditor(page);
  await openFile(page, "About");
  await expect(page.locator(".doc-title")).toHaveText("About");
  await page.getByText("A few words about you").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Elsewhere");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("[Mastodon](https://example.social/@me)");
  const { name, text } = await downloadCurrent(page);
  expect(name).toBe("about.opml");
  expect(text).toContain(`    <outline text="Elsewhere">
      <outline text="[Mastodon](https://example.social/@me)"/>
    </outline>`);
});

test("reset puts the starter blog back", async ({ page }) => {
  await openEditor(page);
  await newEntry(page);
  await page.keyboard.type("throwaway");
  page.once("dialog", (d) => void d.accept());
  await menu(page, "Reset to starter blog");
  await expect(page.getByText("throwaway")).toHaveCount(0);
  await expect(page.getByText("Hello, world")).toBeVisible();
});

/**
 * Milestone 3's goal: write a week of posts in the browser and export valid
 * OPML. The week crosses into a new year, so a new year file is created.
 */
test("a week of posts exports as valid OPML", async ({ page }) => {
  test.setTimeout(60_000);
  const days = [
    "2026-12-28T08:15:00Z",
    "2026-12-29T12:00:00Z",
    "2026-12-30T21:40:00Z",
    "2026-12-31T23:59:30Z",
    "2027-01-01T00:30:00Z",
    "2027-01-02T09:00:00Z",
    "2027-01-03T18:00:00Z",
  ];
  await openEditor(page, days[0]);

  for (const [i, time] of days.entries()) {
    await page.clock.setFixedTime(new Date(time));
    await newEntry(page);
    if (i % 2 === 0) {
      // A titled post with two paragraphs.
      await page.keyboard.type(`Day ${i + 1}`);
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await page.keyboard.type(`First paragraph of day ${i + 1} with a [link](https://example.com).`);
      await page.keyboard.press("Enter");
      await page.keyboard.type("Second paragraph.");
    } else {
      // A short untitled post, then a second one the same day.
      await page.keyboard.type(`Short post on day ${i + 1}.`);
      await page.keyboard.press("Enter");
      await page.keyboard.type(`Another short post on day ${i + 1}.`);
    }
  }

  // The new year has its own file, listed first.
  const files = page.getByRole("navigation", { name: "Files" });
  await expect(files.getByRole("button")).toHaveText(["2027", "2026", "About"]);

  const texts: Record<string, string> = {};
  for (const [label, path] of [
    ["2027", "blog/2027.opml"],
    ["2026", "blog/2026.opml"],
  ]) {
    await openFile(page, label!);
    texts[path!] = (await downloadCurrent(page)).text;
  }
  // blog.opml isn't in the sidebar yet (settings come in M4); read it from storage.
  await expect(page.getByText("Saved in this browser")).toBeVisible();
  texts["blog.opml"] = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const req = indexedDB.open("porridge");
        req.onsuccess = () => {
          const get = req.result.transaction("kv").objectStore("kv").get("file:blog.opml");
          get.onsuccess = () => resolve(get.result as string);
          get.onerror = () => reject(get.error);
        };
      }),
  );

  for (const text of Object.values(texts)) expect(() => parseOpml(text)).not.toThrow();
  expect(texts["blog.opml"]).toContain(`<outline text="2027" type="include" url="blog/2027.opml"/>
    <outline text="2026" type="include" url="blog/2026.opml"/>`);

  const source: ContentSource = {
    read: async (p) => texts[p],
    list: async () => [],
  };
  const site = await loadSite(source);
  expect(site.warnings).toEqual([]);
  expect(site.days.map((d) => d.date)).toEqual([
    "2027-01-03",
    "2027-01-02",
    "2027-01-01",
    "2026-12-31",
    "2026-12-30",
    "2026-12-29",
    "2026-12-28",
    "2026-11-18",
  ]);
  const jan3 = site.days[0]!.entries[0]!;
  expect(jan3.text).toBe("Day 7");
  expect(jan3.anchor).toBe("a180000");
  expect(jan3.body?.map((n) => n.attrs.get("text"))).toEqual([
    "First paragraph of day 7 with a [link](https://example.com).",
    "Second paragraph.",
  ]);
  const jan2 = site.days[1]!.entries;
  expect(jan2.map((e) => [e.text, e.body, e.anchor])).toEqual([
    ["Short post on day 6.", null, "a090000"],
    ["Another short post on day 6.", null, "a090001"],
  ]);
  // 23:59:30 GMT on 31 December is still 2026 in Europe/London.
  expect(site.days[3]!.entries[0]!.anchor).toBe("a235930");
});
