import { expect, test, type Page } from "@playwright/test";
import { editing, newEntry, openEditor, outline } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

/** Make five entries under today: one … five (newest first, so one is at the top). */
async function fiveLines(page: Page) {
  await newEntry(page);
  for (const [i, word] of ["one", "two", "three", "four", "five"].entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(word);
  }
}

const selected = (page: Page) => page.locator(".node.selected > .row .text");
const row = (page: Page, text: string) => page.locator(".row", { has: page.locator(".text", { hasText: new RegExp(`^${text}$`) }) });

test.describe("zoomed-in title", () => {
  test("can be edited, and Enter starts its first child", async ({ page }) => {
    await page.locator(".node.day > .row > .bullet").click();
    await page.getByRole("menuitem", { name: "Zoom in" }).click();
    await page.getByText("Hello, world").click(); // a child of the day
    await page.keyboard.press("Control+]");
    await expect(page.locator(".doc-title")).toHaveText("Hello, world");

    await page.locator(".doc-title .title-text").click();
    await expect(editing(page).first()).toHaveAttribute("aria-label", "Title");
    await page.keyboard.type(" again");
    await page.keyboard.press("Enter");
    await page.keyboard.type("A new first line");
    expect(await outline(page)).toBe(
      "A new first line|\nThis is the first post on a new porridge blog.\nEdit or delete it, then write your own.",
    );

    // ↑ from the first line goes back to the title; Tab does nothing there.
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator("textarea.title-input")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("textarea.title-input")).toHaveValue("Hello, world again");

    await page.keyboard.press("Control+[");
    expect(await outline(page)).toContain("Hello, world again\n  A new first line\n");
  });

  test("calendar headings stay read-only", async ({ page }) => {
    await page.locator(".node.day > .row > .bullet").click();
    await page.getByRole("menuitem", { name: "Zoom in" }).click();
    await expect(page.locator(".doc-title .title-text")).toHaveCount(0);
    await expect(page.locator(".doc-title")).toHaveText("18th November");
  });
});

test.describe("selecting several lines", () => {
  test("Shift-↓ at the end of a line selects lines; Tab indents them together", async ({ page }) => {
    await fiveLines(page);
    // Go to "two" and select two…four.
    await row(page, "two").locator(".text").click();
    await expect(editing(page)).toHaveValue("two");
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(selected(page)).toHaveText(["two", "three", "four"]);
    await expect(editing(page)).toHaveCount(0);

    await page.keyboard.press("Tab");
    expect(await outline(page)).toContain("    one\n      two\n      three\n      four\n    five\n");
    await expect(selected(page)).toHaveText(["two", "three", "four"]);

    await page.keyboard.press("Shift+Tab");
    expect(await outline(page)).toContain("    one\n    two\n    three\n    four\n    five\n");
  });

  test("moving, deleting and undoing a selection", async ({ page }) => {
    await fiveLines(page);
    await row(page, "three").locator(".text").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Alt+Shift+ArrowUp");
    expect(await outline(page)).toContain("    one\n    three\n    four\n    two\n    five\n");
    await page.keyboard.press("Alt+Shift+ArrowUp");
    await page.keyboard.press("Alt+Shift+ArrowUp"); // already at the top: stays
    expect(await outline(page)).toContain("    three\n    four\n    one\n    two\n    five\n");

    await page.keyboard.press("Backspace");
    expect(await outline(page)).toContain("    one\n    two\n    five\n");
    await expect(selected(page)).toHaveCount(0);
    await page.keyboard.press("Control+z");
    expect(await outline(page)).toContain("    three\n    four\n    one\n    two\n    five\n");
  });

  test("dragging across lines selects them", async ({ page }) => {
    await fiveLines(page);
    await page.keyboard.press("Escape");
    const from = (await row(page, "two").locator(".text").boundingBox())!;
    const to = (await row(page, "four").locator(".text").boundingBox())!;
    await page.mouse.move(from.x + 5, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 5, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(selected(page)).toHaveText(["two", "three", "four"]);

    await page.keyboard.press("Tab");
    expect(await outline(page)).toContain("    one\n      two\n      three\n      four\n");
    await page.keyboard.press("Escape");
    await expect(selected(page)).toHaveCount(0);
  });

  test("shift-click selects from the line being edited", async ({ page }) => {
    await fiveLines(page);
    await row(page, "one").locator(".text").click();
    await row(page, "three").locator(".text").click({ modifiers: ["Shift"] });
    await expect(selected(page)).toHaveText(["one", "two", "three"]);
  });

  test("a selection across levels widens to whole lines", async ({ page }) => {
    await page.getByText("Edit or delete it").click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowUp"); // from a child of "Hello, world"…
    await expect(selected(page)).toHaveText([
      "This is the first post on a new porridge blog.",
      "Edit or delete it, then write your own.",
    ]);
    await page.keyboard.press("Shift+ArrowUp"); // …up to "Hello, world" itself: the whole post
    await expect(selected(page)).toHaveText([
      "Hello, world",
      "This is the first post on a new porridge blog.",
      "Edit or delete it, then write your own.",
    ]);
  });

  test("Esc and clicking elsewhere clear it; Enter goes back to typing", async ({ page }) => {
    await fiveLines(page);
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowUp");
    await expect(selected(page)).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(selected(page)).toHaveCount(0);

    await page.keyboard.press("Shift+ArrowUp"); // nothing selected, nothing editing: no effect
    await row(page, "five").locator(".text").click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowUp");
    await page.locator(".doc-title").click();
    await expect(selected(page)).toHaveCount(0);

    await row(page, "five").locator(".text").click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowUp");
    await page.keyboard.press("Enter");
    await expect(editing(page)).toHaveValue("four");
  });
});
