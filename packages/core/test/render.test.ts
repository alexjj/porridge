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
