import { expect, test } from "@playwright/test";
import { connect, connected, fakeGitHub, status, templateFiles } from "./github-helpers.js";
import { menu, newEntry, openEditor, openFile, outline } from "./helpers.js";


test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test("connecting loads the blog from the repository", async ({ page }) => {
  const files = templateFiles();
  files["blog/2026.opml"] = files["blog/2026.opml"]!.replace(
    `<outline text="Hello, world"`,
    `<outline text="From GitHub ![cat](/images/2026/11/cat.jpg)" created="Wed, 18 Nov 2026 13:00:00 GMT"/>\n        <outline text="Hello, world"`,
  );
  await fakeGitHub(page, files);
  await connected(page);
  await expect(page.locator(".rendered", { hasText: "From GitHub" })).toBeVisible();
  // Images load from the repo.
  await expect(page.locator(".rendered img")).toHaveAttribute("src", "https://raw.githubusercontent.com/me/blog/main/images/2026/11/cat.jpg");
  await expect(page.getByRole("link", { name: "me/blog" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("a bad token is explained", async ({ page }) => {
  await fakeGitHub(page);
  await connect(page, "wrong");
  await expect(page.getByRole("dialog", { name: "Settings" }).getByRole("alert")).toHaveText(/didn't accept the token/);
});

test("Save commits changes with [skip ci], so nothing is built", async ({ page }) => {
  const fake = await fakeGitHub(page);
  await connected(page);
  await newEntry(page);
  await page.keyboard.type("Saved, not published");
  await expect(status(page)).toHaveText("1 unsaved change");
  await expect(page.locator(".sidebar .unsaved")).toHaveCount(1);

  await page.keyboard.press("Control+s");
  await expect(status(page)).toHaveText("Saved to GitHub");
  expect(fake.lastMessage()).toBe("Save: blog/2026 [skip ci]");
  expect(fake.read("blog/2026.opml")).toContain(`<outline text="Saved, not published" created="Wed, 18 Nov 2026 19:30:00 GMT"/>`);
  expect(fake.runs).toEqual([]);
  await expect(page.locator(".sidebar .unsaved")).toHaveCount(0);
});

test("Publish commits and follows the build", async ({ page }) => {
  const fake = await fakeGitHub(page);
  await connected(page);
  await newEntry(page);
  await page.keyboard.type("Going live");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(status(page)).toHaveText("Published");
  // The link goes to the site (the template's placeholder address here).
  await expect(status(page).getByRole("link")).toHaveAttribute("href", "https://YOUR-USERNAME.github.io/YOUR-REPO/");
  expect(fake.lastMessage()).toBe("Publish: blog/2026");
  expect(fake.runs.map((r) => [r.event, r.head_sha === fake.head(), r.conclusion])).toEqual([["push", true, "success"]]);
});

test("Publish with nothing to save starts the build directly", async ({ page }) => {
  const fake = await fakeGitHub(page);
  await connected(page);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(status(page)).toHaveText("Published");
  expect(fake.commitCount()).toBe(1);
  expect(fake.runs.map((r) => r.event)).toEqual(["workflow_dispatch"]);
});

test("a failed build links to the run", async ({ page }) => {
  const fake = await fakeGitHub(page);
  fake.failBuilds = true;
  await connected(page);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(status(page)).toHaveText("Build failed");
  await expect(status(page).getByRole("link")).toHaveAttribute("href", "https://github.com/me/blog/actions/runs/1");
});

test("changes made elsewhere to other files are kept and brought in", async ({ page }) => {
  const fake = await fakeGitHub(page);
  await connected(page);
  fake.commitRemote({ "pages/about.opml": templateFiles()["pages/about.opml"]!.replace("A few words about you", "Edited on my phone") });
  await newEntry(page);
  await page.keyboard.type("From the laptop");
  await page.keyboard.press("Control+s");
  await expect(status(page)).toHaveText("Saved to GitHub");
  expect(fake.read("pages/about.opml")).toContain("Edited on my phone");
  expect(fake.read("blog/2026.opml")).toContain("From the laptop");
  await openFile(page, "About");
  await expect(page.getByText("Edited on my phone")).toBeVisible();
});

test("a file changed in both places asks which to keep: mine", async ({ page }) => {
  const fake = await fakeGitHub(page);
  await connected(page);
  fake.commitRemote({ "blog/2026.opml": fake.read("blog/2026.opml")!.replace("Hello, world", "Hello from the phone") });
  await newEntry(page);
  await page.keyboard.type("From the laptop");
  await page.keyboard.press("Control+s");

  const dialog = page.getByRole("dialog", { name: "Changed in two places" });
  await expect(dialog).toContainText("2026");
  await dialog.getByRole("button", { name: "Keep mine" }).click();
  await expect(status(page)).toHaveText("Saved to GitHub");
  expect(fake.read("blog/2026.opml")).toContain("From the laptop");
  expect(fake.read("blog/2026.opml")).not.toContain("Hello from the phone");
  expect(fake.commitCount()).toBe(3);
});

test("a file changed in both places asks which to keep: GitHub's", async ({ page }) => {
  const fake = await fakeGitHub(page);
  await connected(page);
  fake.commitRemote({ "blog/2026.opml": fake.read("blog/2026.opml")!.replace("Hello, world", "Hello from the phone") });
  await newEntry(page);
  await page.keyboard.type("From the laptop");
  await page.keyboard.press("Control+s");
  await page.getByRole("dialog", { name: "Changed in two places" }).getByRole("button", { name: "Use GitHub's" }).click();
  await expect(status(page)).toHaveText("Saved to GitHub");
  await expect(page.getByText("Hello from the phone")).toBeVisible();
  await expect(page.getByText("From the laptop")).toHaveCount(0);
  expect(fake.commitCount()).toBe(2);
});

test("reopening the editor brings in changes from GitHub and keeps unsaved work", async ({ page }) => {
  const fake = await fakeGitHub(page);
  await connected(page);
  await newEntry(page);
  await page.keyboard.type("Not saved yet");
  await expect(status(page)).toHaveText("1 unsaved change");
  fake.commitRemote({ "pages/about.opml": templateFiles()["pages/about.opml"]!.replace("A few words about you", "Changed while away") });

  await page.reload();
  await expect(status(page)).toHaveText("1 unsaved change");
  await expect(page.getByText("Not saved yet")).toBeVisible();
  await openFile(page, "About");
  await expect(page.getByText("Changed while away")).toBeVisible();
});

test("pages can be created, configured, renamed and deleted", async ({ page }) => {
  const fake = await fakeGitHub(page);
  await connected(page);

  await page.getByRole("button", { name: "New page" }).click();
  const create = page.getByRole("dialog", { name: "New page" });
  await create.getByLabel("Title").fill("Books I've read");
  await create.getByRole("button", { name: "Create page" }).click();
  await expect(page.locator(".doc-title")).toContainText("Books I've read");
  await page.keyboard.type("*Middlemarch*");

  await page.getByRole("button", { name: "Page settings" }).click();
  const settings = page.getByRole("dialog", { name: "Page settings" });
  await settings.getByLabel("Navigation label").fill("Books");
  await settings.getByLabel("Order").fill("2");
  await settings.getByLabel("Page address").fill("books");
  await settings.getByRole("button", { name: "Rename" }).click();
  await settings.getByRole("button", { name: "Done" }).click();

  await page.keyboard.press("Control+s");
  await expect(status(page)).toHaveText("Saved to GitHub");
  expect(fake.paths().filter((p) => p.startsWith("pages/"))).toEqual(["pages/about.opml", "pages/books.opml"]);
  const books = fake.read("pages/books.opml")!;
  expect(books).toContain("<title>Books I've read</title>");
  expect(books).toContain("<porridge:inNav>true</porridge:inNav>");
  expect(books).toContain("<porridge:navLabel>Books</porridge:navLabel>");
  expect(books).toContain("<porridge:navOrder>2</porridge:navOrder>");
  expect(books).toContain(`<outline text="*Middlemarch*"/>`);

  await page.getByRole("button", { name: "Page settings" }).click();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("dialog", { name: "Page settings" }).getByRole("button", { name: "Delete page" }).click();
  await page.keyboard.press("Control+s");
  await expect(status(page)).toHaveText("Saved to GitHub");
  expect(fake.read("pages/books.opml")).toBeUndefined();
});

test("blog settings are saved into blog.opml", async ({ page }) => {
  const fake = await fakeGitHub(page);
  await connected(page);
  await menu(page, "Blog settings…");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByLabel("Title").fill("Porridge Daily");
  await dialog.getByLabel("Days on the home page").fill("7");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(status(page)).toHaveText("1 unsaved change");
  await page.keyboard.press("Control+s");
  await expect(status(page)).toHaveText("Saved to GitHub");
  expect(fake.read("blog.opml")).toContain("<title>Porridge Daily</title>");
  expect(fake.read("blog.opml")).toContain("<porridge:homeDays>7</porridge:homeDays>");
});

test("connecting to a repository without a blog uploads this one", async ({ page }) => {
  const fake = await fakeGitHub(page, { "README.md": "# my blog" });
  await newEntry(page);
  await page.keyboard.type("Written before connecting");
  await connected(page);
  expect(fake.paths()).toEqual(["README.md", "blog.opml", "blog/2026.opml", "pages/about.opml"]);
  expect(fake.read("blog/2026.opml")).toContain("Written before connecting");
  expect(fake.lastMessage()).toBe("Add blog from porridge [skip ci]");
});

test("disconnecting keeps the blog in the browser", async ({ page }) => {
  await fakeGitHub(page);
  await connected(page);
  await menu(page, "GitHub…");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close" }).click();
  await expect(status(page)).toHaveText("Saved in this browser");
  await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeVisible();
  expect(await outline(page)).toContain("Hello, world");
});
