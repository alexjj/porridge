// End-to-end tests against the content in fixtures/. The rendered sample blog
// is compared with fixtures/expected/sample-blog; after an intended change to
// the output, refresh those files with `npm test -- -u` and review the diff.

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSite, loadSite, PorridgeError, type Site } from "@porridge/core";
import { buildToDirectory, nodeSource } from "../src/index.js";

const repo = join(import.meta.dirname, "../../..");
const fixture = (name: string) => join(repo, "fixtures", name);
const sample = () => loadSite(nodeSource(fixture("sample-blog")));

const anchors = (site: Site, date: string) => site.days.find((d) => d.date === date)?.entries.map((e) => e.anchor);

describe("sample blog", () => {
  it("reads the settings", async () => {
    const { settings } = await sample();
    expect(settings).toEqual({
      title: "My Daily",
      description: "Notes, mostly daily.",
      ownerName: "Your Name",
      baseUrl: "https://example.github.io/my-blog/",
      basePath: "/my-blog/",
      timezone: "Europe/London",
      homeDays: 10,
      rssItems: 25,
      language: "en-gb",
    });
  });

  it("publishes the right days, newest first", async () => {
    const site = await sample();
    expect(site.days.map((d) => d.date)).toEqual([
      "2026-11-18",
      "2026-11-17",
      "2026-11-02",
      "2026-10-31",
      // 2026-10-12 only has drafts; September 2026 only has a comment.
      "2026-07-16",
      "2026-07-15",
      "2025-12-31",
      "2025-12-01",
      // "Some day in December" has no date.
      "2025-06-15",
    ]);
  });

  it("assigns anchors per the spec", async () => {
    const site = await sample();
    // The draft at 21:05 is dropped but doesn't affect the others.
    expect(anchors(site, "2026-11-18")).toEqual(["a174010", "a091203"]);
    // 23:20 GMT on the 15th is 00:20 BST on the 16th.
    expect(anchors(site, "2026-07-16")).toEqual(["a002000"]);
    expect(anchors(site, "2026-07-15")).toEqual(["a233000"]);
    // No created: counted from the bottom.
    expect(anchors(site, "2025-12-31")).toEqual(["n2", "n1"]);
    // Duplicate gets -2; unparseable created falls back to n1.
    expect(anchors(site, "2025-06-15")).toEqual(["a100000", "a100000-2", "n1"]);
  });

  it("tells titled and untitled entries apart, and drops drafts and comments", async () => {
    const site = await sample();
    const [titled, untitled] = site.days[0]!.entries;
    expect(untitled!.body).toBeNull();
    expect(titled!.text).toBe("Starting porridge");
    expect(titled!.body!.map((n) => n.attrs.get("text")!.slice(0, 20))).toEqual([
      "This entry has child",
      "![A bowl of porridge",
      "A body node with lis",
      "Inline HTML is allow",
    ]);
    // Titled entry whose only child is a comment: heading with no body.
    expect(site.days.find((d) => d.date === "2026-10-31")!.entries[0]!.body).toEqual([]);
  });

  it("loads pages and builds the navigation", async () => {
    const site = await sample();
    expect(site.pages.map((p) => p.slug)).toEqual(["about", "books", "now"]);
    expect(site.nav.map((p) => p.navLabel)).toEqual(["About", "Now"]);
  });

  it("warns about exactly the problems in the fixture", async () => {
    const { warnings } = await sample();
    expect(warnings.map((w) => `${w.file}: ${w.message}`)).toEqual([
      `blog/2025.opml: Skipped day "Some day in December": missing or invalid date "".`,
      `blog/2025.opml: 2025-06-15: two entries share the anchor #a100000; "Same created time as the entry above: th…" gets #a100000-2.`,
      `blog/2025.opml: 2025-06-15: couldn't read created="last Tuesday" on "An unparseable created value: warned abo…".`,
      `blog/2025.opml: Skipped "Not a calendar node: a format error, so …": expected a calendarMonth node.`,
      `pages/Bad_Slug.opml: Skipped page: "Bad_Slug" isn't a valid page name (lowercase letters, digits and hyphens, starting with a letter).`,
      `pages/rss.opml: Skipped page: "rss" is reserved.`,
    ]);
  });

  it("matches the expected output", async () => {
    const { files } = await buildSite(nodeSource(fixture("sample-blog")));
    expect(files.map((f) => f.path).sort()).toMatchSnapshot();
    for (const file of files) {
      await expect(file.content).toMatchFileSnapshot(join(repo, "fixtures/expected/sample-blog", file.path));
    }
  });

  it("can override the base URL for previews", async () => {
    const { files } = await buildSite(nodeSource(fixture("sample-blog")), { baseUrl: "http://localhost:8080" });
    const home = files.find((f) => f.path === "index.html")!.content;
    expect(home).toContain(`href="/style.css"`);
    expect(home).toContain(`href="http://localhost:8080/rss.xml"`);
  });
});

describe("rendered sample blog", async () => {
  const { files } = await buildSite(nodeSource(fixture("sample-blog")));
  const file = (path: string) => files.find((f) => f.path === path)?.content ?? "";

  it("never publishes drafts or comments", () => {
    const all = files.map((f) => f.content).join("\n");
    for (const hidden of [
      "isn't finished yet",
      "Comments are notes to self",
      "Salt, not sugar",
      "Renders as a heading with no body",
      "Every entry on this day is a draft",
      "This whole month only has a comment",
      "Contact details",
      "Remember to add a photo",
      "A draft page",
    ]) {
      expect(all).not.toContain(hidden);
    }
    expect(file("ideas/index.html")).toBe("");
  });

  it("links titles and pilcrows to the day page anchor", () => {
    const day = file("2026/11/18/index.html");
    expect(day).toContain(`<article class="entry" id="a174010">`);
    const hash = (anchor: string) =>
      `<a class="permalink" href="/my-blog/2026/11/18/#${anchor}" title="Link to this entry" aria-label="Link to this entry" data-pagefind-ignore>#</a>`;
    expect(day).toContain(`<h3 class="entry-title">${hash("a174010")}<a href="/my-blog/2026/11/18/#a174010">Starting porridge</a></h3>`);
    expect(day).toContain(`<p>${hash("a091203")}A one-paragraph post`);
  });

  it("rewrites root-relative URLs to the base path, and to absolute URLs in RSS", () => {
    expect(file("2026/11/18/index.html")).toContain(`<img src="/my-blog/images/2026/11/porridge.jpg"`);
    expect(file("rss.xml")).toContain(`&lt;img src=&quot;https://example.github.io/my-blog/images/2026/11/porridge.jpg&quot;`);
  });

  it("embeds a YouTube video on its own line, and links its thumbnail in RSS", () => {
    const day = file("2026/11/18/index.html");
    expect(day).toContain(`<p><span class="video"><iframe src="https://www.youtube-nocookie.com/embed/C-TY_XSMboY?start=90"`);
    expect(day).toContain(`<p>A YouTube address mid-sentence, https://www.youtube.com/watch?v=6NzAn238PPE, stays text.</p>`);
    expect(file("rss.xml")).toContain(
      `&lt;a href=&quot;https://www.youtube.com/watch?v=C-TY_XSMboY&amp;amp;t=90s&quot;&gt;&lt;img src=&quot;https://i.ytimg.com/vi/C-TY_XSMboY/hqdefault.jpg&quot;`,
    );
  });

  it("renders quotes with their source", () => {
    expect(file("2026/11/02/index.html")).toContain(
      `<article class="entry" id="a120000">\n<blockquote class="quote">\n<p><a class="permalink" href="/my-blog/2026/11/02/#a120000"`,
    );
    expect(file("2026/11/02/index.html")).toContain(
      `>#</a>The 2nd: ordinal suffixes are 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 23rd, 31st.</p>\n` +
        `<footer><cite>A quote post; its children are the source, like <a href="https://example.com/spec">the spec</a></cite></footer>\n</blockquote>`,
    );
    expect(file("2026/11/18/index.html")).toContain(`<blockquote class="quote">\n<p>A quote inside a post, with no source.</p>\n</blockquote>`);
    expect(file("about/index.html")).toContain(
      `<blockquote class="quote">\n<p>A quote on a page is a quote, not a section heading.</p>\n<footer><cite>Someone <em>wise</em></cite></footer>\n</blockquote>`,
    );
    // In RSS a quote has no title.
    const item = file("rss.xml").split("<item>").find((i) => i.includes("<link>https://example.github.io/my-blog/2026/11/02/#a120000</link>"))!;
    expect(item).not.toContain("<title>");
    expect(item).toContain("&lt;blockquote class=&quot;quote&quot;&gt;");
  });

  it("renders lines under a body line as paragraphs, unless it has list=bullets", () => {
    const day = file("2026/11/18/index.html");
    expect(day).toContain(
      `autolinks like <a href="https://example.com">https://example.com</a>.</p>\n<p>A line under a line, without list=&quot;bullets&quot;, is just another paragraph.</p>`,
    );
    expect(day).toContain(`becomes a paragraph followed by a list:</p>\n<ul>\n<li>Oats</li>`);
  });

  it("renders list=bullets children as a bulleted list, in posts and pages", () => {
    expect(file("2026/11/17/index.html")).toContain(
      `has a bulleted body.</a></h3>\n<ul>\n<li>Like this.</li>\n<li>And this.\n<ul>\n<li>With a sub-bullet.</li>\n</ul>\n</li>\n</ul>\n</article>`,
    );
    expect(file("books/index.html")).toContain(
      `<h2>2026</h2>\n<ul>\n<li><em>A Book I Liked</em> by Someone</li>\n<li><em>Another One</em> by Someone Else</li>\n</ul>\n</section>`,
    );
    expect(file("rss.xml")).toContain("&lt;li&gt;With a sub-bullet.&lt;/li&gt;");
  });

  it("renders page sections as h2-h4, then lists", () => {
    const about = file("about/index.html");
    expect(about).toContain("<h2>Elsewhere</h2>");
    expect(about).toContain("<h3>Social</h3>");
    expect(about).toContain("<h4>Projects</h4>");
    expect(about).toContain(`<li><a href="https://github.com/alexjj/porridge">porridge</a>\n<ul>\n<li>nested item</li>`);
  });

  it("writes RSS items newest first, titles only for titled entries", () => {
    const rss = file("rss.xml");
    const items = rss.split("<item>").slice(1);
    expect(items).toHaveLength(15);
    expect(items[0]).toContain("<title>Starting porridge</title>");
    expect(items[1]).not.toContain("<title>");
    // No created: pubDate is midnight in the blog's timezone (BST in June).
    expect(items.at(-1)).toContain("<pubDate>Sat, 14 Jun 2025 23:00:00 GMT</pubDate>");
  });
});

describe("build errors", () => {
  it.each([
    ["malformed-xml", "blog/2026.opml", /Couldn't read blog\/2026\.opml/],
    ["missing-include", "blog.opml", /Included file blog\/2025\.opml not found/],
    ["missing-settings", "blog.opml", /missing required settings: title, porridge:baseUrl/],
  ])("%s fails the build", async (name, file, message) => {
    const err = await loadSite(nodeSource(fixture(`errors/${name}`))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PorridgeError);
    expect((err as PorridgeError).file).toBe(file);
    expect((err as PorridgeError).message).toMatch(message);
  });

  it("fails when there's no blog.opml", async () => {
    await expect(loadSite(nodeSource(join(repo, "packages")))).rejects.toThrow(/blog\.opml not found/);
  });
});

describe("buildToDirectory", () => {
  it("writes the site, images and .nojekyll", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "porridge-")), "site");
    await buildToDirectory(fixture("sample-blog"), out);
    for (const path of ["index.html", "2026/11/18/index.html", "rss.xml", "images/2026/11/porridge.jpg", ".nojekyll"]) {
      expect(existsSync(join(out, path)), path).toBe(true);
    }
    expect(readFileSync(join(out, "images/2026/11/porridge.jpg")).equals(
      readFileSync(fixture("sample-blog/images/2026/11/porridge.jpg")),
    )).toBe(true);
  });

  it("refuses to write over the content", async () => {
    await expect(buildToDirectory(fixture("sample-blog"), fixture("sample-blog"))).rejects.toThrow(/can't contain/);
    await expect(buildToDirectory(fixture("sample-blog"), repo)).rejects.toThrow(/can't contain/);
  });

  it("builds the starter template cleanly", async () => {
    // The template sets no site address; the Action passes the Pages address.
    const { warnings, site, files } = await buildSite(nodeSource(join(repo, "template")), {
      fallbackBaseUrl: "https://me.github.io/blog/",
    });
    expect(site.settings.baseUrl).toBe("https://me.github.io/blog/");
    expect(warnings).toEqual([]);
    // Two months of example posts; the draft isn't published.
    expect(site.days.map((d) => d.date)).toEqual(["2026-11-18", "2026-11-16", "2026-11-12", "2026-10-28", "2026-10-14", "2026-10-03"]);
    expect(site.days.flatMap((d) => d.entries)).toHaveLength(9);
    // Every image the starter uses is in the template.
    const html = files.map((f) => f.content).join("\n");
    for (const [, path] of html.matchAll(/src="\/(images\/[^"]+)"/g)) {
      expect(existsSync(join(repo, "template", path!)), path).toBe(true);
    }
  });
});

describe("search", async () => {
  const { files } = await buildSite(nodeSource(fixture("sample-blog")));
  const file = (path: string) => files.find((f) => f.path === path)?.content ?? "";

  it("has a search page and a search link in the navigation", () => {
    expect(file("search/index.html")).toContain(`<script src="/my-blog/pagefind/pagefind-ui.js"></script>`);
    expect(file("search/index.html")).toContain(`<link rel="stylesheet" href="/my-blog/pagefind/pagefind-ui.css">`);
    expect(file("index.html")).toContain(`<a class="search-link" href="/my-blog/search/" aria-label="Search" title="Search">`);
  });

  it("marks only day pages and pages for indexing", () => {
    const indexed = files.filter((f) => f.content.includes("<main data-pagefind-body>")).map((f) => f.path).sort();
    expect(indexed).toEqual([
      "2025/06/15/index.html",
      "2025/12/01/index.html",
      "2025/12/31/index.html",
      "2026/07/15/index.html",
      "2026/07/16/index.html",
      "2026/10/31/index.html",
      "2026/11/02/index.html",
      "2026/11/17/index.html",
      "2026/11/18/index.html",
      "about/index.html",
      "books/index.html",
      "now/index.html",
    ]);
  });

  it("Pagefind indexes exactly those pages", async () => {
    const pagefind = await import("pagefind");
    const out = join(mkdtempSync(join(tmpdir(), "porridge-search-")), "site");
    await buildToDirectory(fixture("sample-blog"), out);
    const { index } = await pagefind.createIndex({});
    const result = await index!.addDirectory({ path: out });
    expect(result.errors).toEqual([]);
    // page_count counts every HTML file read; the written index says how many were kept.
    await index!.writeFiles({ outputPath: join(out, "pagefind") });
    await pagefind.close();
    const entry = JSON.parse(readFileSync(join(out, "pagefind/pagefind-entry.json"), "utf8"));
    expect(entry.languages["en-gb"].page_count).toBe(12);
  }, 60_000);
});
