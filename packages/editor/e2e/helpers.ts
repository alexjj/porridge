import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";

/** Open the editor with the clock fixed at `time` and a fresh starter blog. */
export async function openEditor(page: Page, time = "2026-11-18T19:30:00Z") {
  await page.clock.setFixedTime(new Date(time));
  await page.goto("/");
  await expect(page.locator(".nodes")).toBeVisible();
}

/** The outline as indented text (two spaces per level); the edited line ends with `|`. */
export async function outline(page: Page): Promise<string> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walk = (ul: Element, depth: number) => {
      for (const li of Array.from(ul.children)) {
        const row = li.querySelector(":scope > .row")!;
        const ta = row.querySelector("textarea");
        const text = ta ? `${ta.value}|` : (row.querySelector(".text, .label") as HTMLElement).innerText;
        const collapsed = row.querySelector(".toggle.closed") ? " [+]" : "";
        out.push("  ".repeat(depth) + text + collapsed);
        const kids = li.querySelector(":scope > .children");
        if (kids) walk(kids, depth + 1);
      }
    };
    walk(document.querySelector(".nodes")!, 0);
    return out.join("\n");
  });
}

export async function newEntry(page: Page) {
  await page.getByRole("button", { name: "New entry" }).click();
  await expect(page.locator("textarea")).toBeFocused();
}

/** The textarea currently being edited. */
export const editing = (page: Page) => page.locator("textarea");

export async function caret(page: Page): Promise<number> {
  return editing(page).evaluate((ta: HTMLTextAreaElement) => ta.selectionStart);
}

export async function menu(page: Page, item: string) {
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** Download a file through the menu and return its text. */
export async function downloadCurrent(page: Page): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([page.waitForEvent("download"), menu(page, "Download this file")]);
  return { name: download.suggestedFilename(), text: await readFile((await download.path())!, "utf8") };
}

export async function openFile(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Files" }).getByRole("button", { name, exact: true }).click();
}
