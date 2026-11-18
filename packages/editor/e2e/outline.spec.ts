import { expect, test } from "@playwright/test";
import { caret, editing, newEntry, openEditor, outline } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

const STARTER_TAIL = `    Hello, world
      This is the first post on a new porridge blog.
      Edit or delete it, then write your own.`;

test("New entry starts a line at the top of today", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("Morning");
  expect(await outline(page)).toBe(`November 2026
  18th November
    Morning|
${STARTER_TAIL}`);
});

test("Enter splits at the cursor, and at the start opens a line above", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("onetwo");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  expect(await outline(page)).toContain("    one\n    two|\n");
  expect(await caret(page)).toBe(0);

  await page.keyboard.press("Enter");
  expect(await outline(page)).toContain("    one\n    \n    two|\n");
});

test("Enter on a line with children adds its first child", async ({ page }) => {
  await page.getByText("Hello, world").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("new first child");
  expect(await outline(page)).toContain("    Hello, world\n      new first child|\n      This is the first post");
});

test("Tab and Shift-Tab indent and outdent, but not out of the day", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("title");
  await page.keyboard.press("Enter");
  await page.keyboard.type("body");
  await page.keyboard.press("Tab");
  expect(await outline(page)).toContain("    title\n      body|\n");
  expect(await caret(page)).toBe(4);

  await page.keyboard.press("Shift+Tab");
  expect(await outline(page)).toContain("    title\n    body|\n");
  // Already an entry: outdenting would take it out of the day.
  await page.keyboard.press("Shift+Tab");
  expect(await outline(page)).toContain("    title\n    body|\n");
});

test("Alt-Shift-arrows move a line among its siblings", async ({ page }) => {
  await page.getByText("Edit or delete it").click();
  await page.keyboard.press("Alt+Shift+ArrowUp");
  expect(await outline(page)).toContain(
    "      Edit or delete it, then write your own.|\n      This is the first post on a new porridge blog.",
  );
  // Already first: stays put.
  await page.keyboard.press("Alt+Shift+ArrowUp");
  await page.keyboard.press("Alt+Shift+ArrowDown");
  expect(await outline(page)).toContain(
    "      This is the first post on a new porridge blog.\n      Edit or delete it, then write your own.|",
  );
});

test("Backspace at the start joins with the line above; Delete at the end joins the next", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("ab");
  await page.keyboard.press("Enter");
  await page.keyboard.type("cd");
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  expect(await outline(page)).toContain("    abcd|\n    Hello, world");
  expect(await caret(page)).toBe(2);

  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("End");
  await page.keyboard.press("Delete");
  expect(await outline(page)).toContain("    abcd|\n    Hello, world");
});

test("Ctrl-Shift-Backspace deletes a line and its children", async ({ page }) => {
  await page.getByText("Hello, world").click();
  await page.keyboard.press("Control+Shift+Backspace");
  expect(await outline(page)).toBe("November 2026\n  18th November");
});

test("undo and redo", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("first");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second");
  await page.keyboard.press("Tab");
  const done = await outline(page);

  await page.keyboard.press("Control+z"); // Tab
  expect(await outline(page)).toContain("    first\n    second|\n");
  await page.keyboard.press("Control+z"); // typing "second"
  expect(await outline(page)).toContain("    first\n    |\n");
  await page.keyboard.press("Control+z"); // Enter
  expect(await outline(page)).toContain("    first|\n    Hello");

  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+y");
  expect(await outline(page)).toBe(done);
});

test("arrow keys move between lines, skipping calendar headings", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("top");
  await page.keyboard.press("ArrowDown");
  expect(await outline(page)).toContain("    Hello, world|");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  expect(await outline(page)).toContain("    top|");
  // Nothing editable above: focus stays.
  await page.keyboard.press("ArrowUp");
  expect(await outline(page)).toContain("    top|");
  // Left at the start of a line goes to the end of the previous one.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  expect(await outline(page)).toContain("    top|");
  expect(await caret(page)).toBe(3);
});

test("collapse, expand and zoom", async ({ page }) => {
  await page.getByText("Hello, world").click();
  await page.keyboard.press("Control+ArrowUp");
  expect(await outline(page)).toBe("November 2026\n  18th November\n    Hello, world| [+]");
  await page.keyboard.press("Control+ArrowDown");
  expect(await outline(page)).toContain("Hello, world|\n      This is the first post");

  await page.keyboard.press("Control+]");
  await expect(page.locator(".doc-title")).toHaveText("Hello, world");
  await expect(page.locator(".crumbs")).toHaveText(/2026\s*›\s*November 2026\s*›\s*18th November/);
  expect(await outline(page)).toBe("This is the first post on a new porridge blog.\nEdit or delete it, then write your own.");

  await page.getByText("This is the first post").click();
  await page.keyboard.press("Control+[");
  await expect(page.locator(".doc-title")).toHaveText("18th November");
  await page.locator(".crumbs").getByRole("button", { name: "2026", exact: true }).click();
  await expect(page.locator(".doc-title")).toHaveText("2026");

  // A bullet's menu zooms too.
  await page.locator(".node.day > .row > .bullet").click();
  await page.getByRole("menu", { name: "Line menu" }).getByRole("menuitem", { name: "Zoom in" }).click();
  await expect(page.locator(".doc-title")).toHaveText("18th November");
});

test("bold and italic shortcuts wrap the selection", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("make this bold");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Control+b");
  await page.keyboard.press("Escape");
  await expect(page.locator(".node strong", { hasText: "bold" })).toBeVisible();
});

test("pasting several lines makes several lines", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("start ");
  await editing(page).evaluate((ta) => {
    const data = new DataTransfer();
    data.setData("text/plain", "one\ntwo\nthree");
    ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  expect(await outline(page)).toContain("    start one\n    two\n    three|\n");
});

test("rendered Markdown shows when not editing, raw text when editing", async ({ page }) => {
  await newEntry(page);
  await page.keyboard.type("see [the site](https://example.com)");
  await page.keyboard.press("Escape");
  const link = page.locator(".rendered a", { hasText: "the site" });
  await expect(link).toHaveAttribute("href", "https://example.com");
  await page.locator(".rendered", { hasText: "see" }).click({ position: { x: 5, y: 5 } });
  await expect(editing(page)).toHaveValue("see [the site](https://example.com)");
});
