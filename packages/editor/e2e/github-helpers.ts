import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, type Page } from "@playwright/test";
import { FakeGitHub } from "../test/fake-github.js";

const TEMPLATE = join(import.meta.dirname, "../../../template");

export function templateFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(TEMPLATE, p)] = readFileSync(p, "utf8");
    }
  };
  walk(TEMPLATE);
  return out;
}

/** Point the page's GitHub API calls at a fake repo seeded with the template. */
export async function fakeGitHub(page: Page, files: Record<string, string> = templateFiles()): Promise<FakeGitHub> {
  const fake = new FakeGitHub(files);
  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const r = fake.handle(req.url(), req.method(), await req.allHeaders(), req.postData() ?? undefined);
    await route.fulfill({ status: r.status, body: r.body ?? "", headers: r.headers });
  });
  // Images load straight from the repo; answer with a 1×1 PNG.
  await page.route("https://raw.githubusercontent.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"),
    }),
  );
  return fake;
}

export async function connect(page: Page, token = "good-token") {
  await page.getByRole("button", { name: "Connect GitHub" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByLabel("Repository").fill("me/blog");
  await dialog.getByLabel("Token").fill(token);
  page.once("dialog", (d) => void d.accept());
  await dialog.getByRole("button", { name: "Connect" }).click();
}

export async function connected(page: Page) {
  await connect(page);
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
  await expect(status(page)).toHaveText("Saved to GitHub");
}

export const status = (page: Page) => page.locator(".topbar").getByRole("status");

