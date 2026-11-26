import { describe, expect, it } from "vitest";
import { buildSite, navUrlProblem, type ContentSource } from "../src/index.js";

const page = (title: string, head = "") =>
  `<opml version="2.0" xmlns:porridge="https://github.com/alexjj/porridge"><head><title>${title}</title><porridge:inNav>true</porridge:inNav>${head}</head><body/></opml>`;

async function build(head: string, pages: Record<string, string> = {}) {
  const files: Record<string, string> = {
    "blog.opml": `<opml version="2.0" xmlns:porridge="https://github.com/alexjj/porridge"><head><title>T</title>
<porridge:baseUrl>https://e.com/blog/</porridge:baseUrl>${head}</head><body/></opml>`,
  };
  for (const [slug, text] of Object.entries(pages)) files[`pages/${slug}.opml`] = text;
  const source: ContentSource = {
    read: async (p) => files[p],
    list: async (dir) => (dir === "pages" ? Object.keys(pages).map((s) => `${s}.opml`) : []),
  };
  const { files: out, site } = await buildSite(source);
  const home = out.find((f) => f.path === "index.html")!.content;
  const nav = /<nav class="site-nav">\n([\s\S]*?)\n<\/nav>/.exec(home)![1]!.split("\n").slice(0, -1); // without search
  return { site, nav };
}

describe("navigation links", () => {
  it("puts outside links among the pages by their order, then the archive", async () => {
    const { nav, site } = await build(
      `<porridge:navLink url="https://github.com/me" navOrder="5">GitHub</porridge:navLink>
<porridge:navLink url="/about/#contact">Contact</porridge:navLink>
<porridge:navLink url="mailto:me@e.com" navOrder="200">Email</porridge:navLink>`,
      { about: page("About", "<porridge:navOrder>1</porridge:navOrder>"), now: page("Now", "<porridge:navOrder>10</porridge:navOrder>") },
    );
    expect(site.warnings).toEqual([]);
    expect(nav).toEqual([
      `<a href="/blog/about/">About</a>`,
      `<a href="https://github.com/me">GitHub</a>`,
      `<a href="/blog/now/">Now</a>`,
      `<a href="/blog/about/#contact">Contact</a>`,
      `<a href="mailto:me@e.com">Email</a>`,
      `<a href="/blog/archive/">Archive</a>`,
    ]);
  });

  it("places the archive by porridge:archiveNavOrder", async () => {
    const { nav } = await build(
      `<porridge:archiveNavOrder>0</porridge:archiveNavOrder><porridge:navLink url="https://x.com/" navOrder="0">X</porridge:navLink>`,
      { about: page("About") },
    );
    expect(nav).toEqual([`<a href="https://x.com/">X</a>`, `<a href="/blog/archive/">Archive</a>`, `<a href="/blog/about/">About</a>`]);
  });

  it("escapes links and skips ones without a label or a web address", async () => {
    const { nav, site } = await build(
      `<porridge:navLink url="https://e.com/?a=1&amp;b=&quot;2&quot;">A &amp; B</porridge:navLink>
<porridge:navLink url="javascript:alert(1)">Bad</porridge:navLink>
<porridge:navLink url="https://e.com/"></porridge:navLink>
<porridge:navLink url="https://e.com/" navOrder="soon">Later</porridge:navLink>`,
    );
    expect(nav).toEqual([`<a href="https://e.com/?a=1&amp;b=&quot;2&quot;">A &amp; B</a>`, `<a href="https://e.com/">Later</a>`, `<a href="/blog/archive/">Archive</a>`]);
    expect(site.warnings.map((w) => w.message)).toEqual([
      `Skipped navigation link "Bad": "javascript:alert(1)" isn't a web address (start it with https:// or /).`,
      `Skipped navigation link: it has no label.`,
      `navOrder of "Later" "soon" isn't a number, using 100.`,
    ]);
  });

  it("checks addresses", () => {
    expect(navUrlProblem("https://e.com")).toBeUndefined();
    expect(navUrlProblem("/now/")).toBeUndefined();
    expect(navUrlProblem("mailto:a@b.c")).toBeUndefined();
    expect(navUrlProblem("//evil.com")).toBeDefined();
    expect(navUrlProblem("e.com")).toBeDefined();
    expect(navUrlProblem("")).toBe("it has no address");
  });
});
