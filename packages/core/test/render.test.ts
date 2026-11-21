import { describe, expect, it } from "vitest";
import { buildSite, type ContentSource } from "../src/index.js";

function memorySource(files: Record<string, string>): ContentSource {
  return {
    read: async (path) => files[path],
    list: async (dir) =>
      Object.keys(files)
        .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/"))
        .map((p) => p.slice(dir.length + 1)),
  };
}

const NS = `xmlns:porridge="https://github.com/alexjj/porridge"`;
const blog = (homeDays: number) => `<opml version="2.0" ${NS}><head><title>T</title>
<porridge:baseUrl>https://e.com/</porridge:baseUrl><porridge:homeDays>${homeDays}</porridge:homeDays></head>
<body><outline text="2026" type="include" url="blog/2026.opml"/></body></opml>`;
const year = `<opml version="2.0"><body>
<outline text="November 2026" type="calendarMonth" date="2026-11">
  <outline text="18th November" type="calendarDay" date="2026-11-18"><outline text="c" created="Wed, 18 Nov 2026 10:00:00 GMT"/></outline>
  <outline text="17th November" type="calendarDay" date="2026-11-17"><outline text="b" created="Tue, 17 Nov 2026 10:00:00 GMT"/></outline>
</outline>
<outline text="October 2026" type="calendarMonth" date="2026-10">
  <outline text="1st October" type="calendarDay" date="2026-10-01"><outline text="a" created="Thu, 01 Oct 2026 10:00:00 GMT"/></outline>
</outline></body></opml>`;

const home = async (homeDays: number) => {
  const { files } = await buildSite(memorySource({ "blog.opml": blog(homeDays), "blog/2026.opml": year }));
  return files.find((f) => f.path === "index.html")!.content;
};

describe("home page", () => {
  it("shows homeDays days and links older posts to the next day's month", async () => {
    const html = await home(2);
    expect(html).toContain("Wednesday 18th November 2026");
    expect(html).toContain("Tuesday 17th November 2026");
    expect(html).not.toContain("Thursday 1st October 2026");
    expect(html).toContain(`<a class="older" href="/2026/10/">Older posts →</a>`);
  });

  it("has no pager when everything fits", async () => {
    expect(await home(10)).not.toContain(`class="pager"`);
  });

  it("works with no posts at all", async () => {
    const { files } = await buildSite(
      memorySource({ "blog.opml": blog(10).replace(/<body>.*<\/body>/s, "<body/>") }),
    );
    expect(files.find((f) => f.path === "index.html")!.content).toContain("Nothing here yet.");
    expect(files.find((f) => f.path === "rss.xml")!.content).not.toContain("<item>");
  });
});

describe("permalinks", () => {
  const withEntry = (text: string) =>
    year.replace(`<outline text="c" created="Wed, 18 Nov 2026 10:00:00 GMT"/>`, `<outline text="${text}" created="Wed, 18 Nov 2026 10:00:00 GMT"/>`);
  const dayPage = async (text: string) => {
    const { files } = await buildSite(memorySource({ "blog.opml": blog(10), "blog/2026.opml": withEntry(text) }));
    return files.find((f) => f.path === "2026/11/18/index.html")!.content;
  };
  const HASH = `<a class="permalink" href="/2026/11/18/#a100000" title="Link to this entry" aria-label="Link to this entry" data-pagefind-ignore>#</a>`;

  it("puts the # before the caption of a post that starts with a captioned image", async () => {
    expect(await dayPage("![Notebooks](/images/n.webp)")).toContain(
      `<p><span class="figure"><img src="/images/n.webp" alt="Notebooks">` +
        `<span class="caption-line">${HASH}<span class="caption" aria-hidden="true">Notebooks</span></span></span></p>`,
    );
  });

  it("keeps the # at the start for text, and for images without a caption", async () => {
    expect(await dayPage("Text first ![Notebooks](/images/n.webp)")).toContain(`<p>${HASH}Text first`);
    expect(await dayPage("![](/images/n.webp)")).toContain(`<p>${HASH}<img src="/images/n.webp" alt=""></p>`);
  });
});

describe("bullets don't spread", () => {
  it("only lines with list=bullets get a list; a sibling's children stay paragraphs", async () => {
    const post = `<outline text="Updates" created="Wed, 18 Nov 2026 10:00:00 GMT">
      <outline text="You can add bullets now." list="bullets"><outline text="We're all children"/><outline text="I'm the favourite"/></outline>
      <outline text="New domain"><outline text="btw, custom domains work too."/></outline>
    </outline>`;
    const y = year.replace(`<outline text="c" created="Wed, 18 Nov 2026 10:00:00 GMT"/>`, post);
    const { files } = await buildSite(memorySource({ "blog.opml": blog(10), "blog/2026.opml": y }));
    const html = files.find((f) => f.path === "2026/11/18/index.html")!.content;
    expect(html).toContain(`<p>You can add bullets now.</p>\n<ul>\n<li>We're all children</li>\n<li>I'm the favourite</li>\n</ul>`);
    expect(html).toContain(`<p>New domain</p>\n<p>btw, custom domains work too.</p>`);
  });
});

describe("site address", () => {
  const withBase = (base: string | null) =>
    blog(10).replace("<porridge:baseUrl>https://e.com/</porridge:baseUrl>", base === null ? "" : `<porridge:baseUrl>${base}</porridge:baseUrl>`);
  const settings = async (base: string | null, fallbackBaseUrl?: string) =>
    (await buildSite(memorySource({ "blog.opml": withBase(base), "blog/2026.opml": year }), { fallbackBaseUrl })).site;

  it("uses the fallback (the Pages address) when blog.opml has none", async () => {
    const site = await settings(null, "https://me.github.io/blog");
    expect(site.settings.baseUrl).toBe("https://me.github.io/blog/");
    expect(site.settings.basePath).toBe("/blog/");
  });

  it("treats the template's placeholder as not set", async () => {
    const site = await settings("https://YOUR-USERNAME.github.io/YOUR-REPO/", "https://me.github.io/blog/");
    expect(site.settings.baseUrl).toBe("https://me.github.io/blog/");
    expect(site.warnings).toEqual([]);
  });

  it("prefers the blog's own address", async () => {
    expect((await settings("https://blog.example/", "https://me.github.io/blog/")).settings.baseUrl).toBe("https://blog.example/");
  });

  it("warns about the placeholder, and needs an address, without a fallback", async () => {
    const site = await settings("https://YOUR-USERNAME.github.io/YOUR-REPO/");
    expect(site.warnings.map((w) => w.message)).toEqual([
      "porridge:baseUrl is still the template's placeholder (https://YOUR-USERNAME.github.io/YOUR-REPO/); set your site's address in Blog settings.",
    ]);
    await expect(settings(null)).rejects.toThrow(/missing required settings: porridge:baseUrl/);
  });
});

describe("settings", () => {
  it("warns about bad values and falls back to defaults", async () => {
    const bad = blog(0).replace("</head>", "<porridge:timezone>Mars/Olympus</porridge:timezone></head>");
    const { site } = await buildSite(memorySource({ "blog.opml": bad, "blog/2026.opml": year }));
    expect(site.settings.homeDays).toBe(10);
    expect(site.settings.timezone).toBe("UTC");
    expect(site.warnings.map((w) => w.message)).toEqual([
      `Unknown timezone "Mars/Olympus", using UTC.`,
      `porridge:homeDays "0" isn't a positive whole number, using 10.`,
    ]);
  });

  it("refuses includes outside the repo", async () => {
    const escape = blog(10).replace("blog/2026.opml", "../secret.opml");
    await expect(buildSite(memorySource({ "blog.opml": escape }))).rejects.toThrow(/outside the repo/);
  });
});
