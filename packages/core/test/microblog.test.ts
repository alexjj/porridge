import { describe, expect, it } from "vitest";
import { convertMicroblog, createInlineRenderer, retarget, uploadSource, type ImportLine } from "../src/index.js";

const item = (content_text: string, extra: Record<string, unknown> = {}) => ({
  id: "http://me.micro.blog/2025/09/12/x/",
  url: "https://blog.example/2025/09/12/x/",
  content_text,
  date_published: "2025-09-12T07:58:59+01:00",
  ...extra,
});

const convert = (...items: unknown[]) => convertMicroblog({ items }, "Europe/London");
const one = (text: string, extra: Record<string, unknown> = {}) => convert(item(text, extra)).posts[0]!;

/** The outline as indented text, attributes other than created/importedFrom in braces. */
const show = (l: ImportLine, d = 0): string[] => [
  `${"  ".repeat(d)}${l.text}${Object.entries(l.attrs ?? {})
    .filter(([k]) => k !== "created" && k !== "importedFrom")
    .map(([k, v]) => ` {${k}=${v}}`)
    .join("")}`,
  ...(l.children ?? []).flatMap((c) => show(c, d + 1)),
];

describe("micro.blog posts", () => {
  it("keeps the moment, filed by the blog's timezone, with tags and the old address", () => {
    const post = one("Hello.", { tags: ["Lego", "Trains"] });
    expect(post.date).toBe("2025-09-12");
    expect(post.line.attrs).toEqual({
      created: "Fri, 12 Sep 2025 06:58:59 GMT",
      category: "Lego, Trains",
      importedFrom: "https://blog.example/2025/09/12/x/",
    });
    // micro.blog's fixed +01:00 in January is 14:33 in London.
    expect(convert(item("x", { date_published: "2026-01-15T15:33:55+01:00" })).posts[0]!.line.attrs!.created).toBe(
      "Thu, 15 Jan 2026 14:33:55 GMT",
    );
  });

  it("titled posts, one-paragraph posts, and posts with no title but several paragraphs", () => {
    expect(show(one("First.\r\n\r\nSecond.", { title: "A title" }).line)).toEqual(["A title", "  First.", "  Second."]);
    expect(show(one("Just this.").line)).toEqual(["Just this."]);
    expect(show(one("First.\n\nSecond.\n\nThird.").line)).toEqual(["First. {isUntitled=true}", "  Second.", "  Third."]);
  });

  it("joins a paragraph's lines, keeps hard breaks, and splits off images on their own line", () => {
    expect(show(one("I should look on a map. \n![A274A424.jpg](https://blog.example/uploads/2026/a274.jpg)\nMore  text here  \nand a break.").line)).toEqual([
      "I should look on a map. {isUntitled=true}",
      "  ![](/images/2025/09/a274-12075859.webp)",
      "  More text here<br>and a break.",
    ]);
  });

  it("finds every kind of image in the archive, never the thumbnails", () => {
    const r = convert(
      item(
        [
          `<figure>\n\t<img src="uploads/2026/81a5.jpg" alt="A hillside">\n\t<figcaption>Ben Rinnes</figcaption>\n</figure>`,
          `![Bands](https://me.micro.blog/uploads/2025/956a.jpg "Comparing")`,
          `<div class="microblog_collection"><img src="https://eu.uploads.micro.blog/233514/2025/deb5-m.jpg" alt="A stream" data-microblog-lightbox="https://eu.uploads.micro.blog/233514/2025/deb5.jpg"><img src="https://eu.uploads.micro.blog/233514/2025/b444-m.jpg" alt="Two people"></div>`,
          `Text with ![inline](https://blog.example/uploads/2025/in.png) image, and [a link](https://example.com).`,
          `![](https://elsewhere.example/photo.jpg)`,
        ].join("\n\n"),
      ),
    );
    expect(show(r.posts[0]!.line)).toEqual([
      "![Ben Rinnes](/images/2025/09/81a5-12075859.webp) {isUntitled=true}",
      "  ![Bands](/images/2025/09/956a-12075859.webp)",
      "  ![A stream](/images/2025/09/deb5-12075859.webp)",
      "  ![Two people](/images/2025/09/b444-12075859.webp)",
      "  Text with ![inline](/images/2025/09/in-12075859.webp) image, and [a link](https://example.com).",
      "  ![](https://elsewhere.example/photo.jpg)",
    ]);
    expect(r.media.map((m) => m.source)).toEqual([
      "uploads/2026/81a5.jpg",
      "uploads/2025/956a.jpg",
      "uploads/2025/deb5.jpg",
      "uploads/2025/b444.jpg",
      "uploads/2025/in.png",
    ]);
  });

  it("copies an image used twice once, and keeps names apart", () => {
    const r = convert(
      item("![](https://blog.example/uploads/2025/a.jpg)\n\n![](https://blog.example/uploads/2025/a.jpg)"),
      item("![](https://blog.example/uploads/2024/a.jpg)", { url: "https://blog.example/other/" }),
    );
    expect(r.media.map((m) => m.target)).toEqual(["images/2025/09/a-12075859.webp", "images/2025/09/a-12075859-2.webp"]);
  });

  it("videos, YouTube, headings, quotes, lists, code, tables and footnotes", () => {
    const post = one(
      [
        `<video controls src="https://blog.example/uploads/2025/d63c.mp4"></video>`,
        `{{< yt "ArxhS4SQaP0" >}}`,
        `## What I wanted`,
        `- Plain text\n- Quick to add\n  - from anywhere`,
        `> If I wanted to see a man eating an orange<br>\r\n> — <cite>Willie 🍊</cite>`,
        `> Alice: Which way?\n> Cat: That depends.`,
        "```python\ndef f(x):\n    return x * 2 # [doubled]\n```",
        `| **Band** | Rate |\n|---|---|\n| Starter | 19% |`,
        `Not a fortune. [^1] Really.`,
        `---`,
        `Two methods:`,
        `1. Dropbox.\nWon't work.`,
        `2. Git.`,
        `[^1]: I still spent a fortune.`,
        `{{< map loc="56.9,-3.8" >}}`,
      ].join("\n\n"),
      { title: "All sorts" },
    );
    expect(show(post.line)).toEqual([
      "All sorts",
      `  <video controls src="/images/2025/09/d63c-12075859.mp4"></video>`,
      "  https://youtu.be/ArxhS4SQaP0",
      "  **What I wanted** {list=bullets}",
      "    Plain text",
      "    Quick to add",
      "      from anywhere",
      "  >If I wanted to see a man eating an orange",
      "    <cite>Willie 🍊</cite>",
      "  >Alice: Which way?<br>Cat: That depends.",
      "  <pre><code>def f(x):&#10;    return x &#42; 2 # &#91;doubled&#93;</code></pre>",
      "  <table><thead><tr><th>**Band**</th><th>Rate</th></tr></thead><tbody><tr><td>Starter</td><td>19%</td></tr></tbody></table>",
      "  Not a fortune. <sup>1</sup> Really.",
      "  Two methods: {list=bullets}",
      "    Dropbox. Won't work.",
      "    Git.",
      "  <sup>1</sup> I still spent a fortune.",
      `  {{< map loc="56.9,-3.8" >}}`,
    ]);
    expect(post.notes).toEqual([
      "code block",
      "table",
      "horizontal rule left out",
      "footnote",
      "micro.blog shortcode (e.g. a map) left as text",
    ]);
  });

  it("renders code as written", () => {
    const md = createInlineRenderer("/");
    const code = one("```\na * b_c [x](y) <tag> & `q`\n  indented\n```").line.text;
    expect(md.html(code)).toBe("<pre><code>a * b_c [x](y) &lt;tag&gt; &amp; `q`\n  indented</code></pre>");
  });

  it("points posts at an image's new name when it's kept in another format", () => {
    const r = convert(item("![](https://blog.example/uploads/2025/a.png)"));
    retarget(r, "images/2025/09/a-12075859.webp", "images/2025/09/a-12075859.png");
    expect(r.posts[0]!.line.text).toBe("![](/images/2025/09/a-12075859.png)");
    expect(r.media[0]!.target).toBe("images/2025/09/a-12075859.png");
  });

  it("orders posts oldest first and skips ones it can't read", () => {
    const r = convert(item("Newer"), item("Older", { date_published: "2016-01-01T03:01:00+01:00" }), item("No date", { date_published: "" }), item("", { url: "https://e/empty/" }));
    expect(r.posts.map((p) => p.line.text)).toEqual(["Older", "Newer"]);
    expect(r.skipped).toEqual(["https://blog.example/2025/09/12/x/: no date", "https://e/empty/: empty"]);
    expect(() => convertMicroblog({}, "UTC")).toThrow(/isn't a micro\.blog archive/);
  });

  it("knows where uploads are in the archive", () => {
    expect(uploadSource("https://micro.alexjj.com/uploads/2026/a2450.jpg")).toBe("uploads/2026/a2450.jpg");
    expect(uploadSource("uploads/2026/x.jpg")).toBe("uploads/2026/x.jpg");
    expect(uploadSource("https://eu.uploads.micro.blog/233514/2025/deb5-s.jpg")).toBe("uploads/2025/deb5.jpg");
    expect(uploadSource("https://example.com/photo.jpg")).toBeUndefined();
  });
});

describe("HTML with root-relative addresses", () => {
  it("rewrites src, poster and href like Markdown links and images", () => {
    const md = createInlineRenderer("/blog/", "https://raw.example/");
    expect(md.html(`<video controls src="/images/2025/09/a.mp4" poster="/images/p.webp"></video> <a href="/about/">x</a> <a href="//cdn.example/y">y</a>`)).toBe(
      `<video controls src="https://raw.example/images/2025/09/a.mp4" poster="https://raw.example/images/p.webp"></video> <a href="/blog/about/">x</a> <a href="//cdn.example/y">y</a>`,
    );
  });
});

describe("files missing from the archive", () => {
  it("keep the address the post had, made absolute", async () => {
    const { convertMicroblog: c, unlinkMedia } = await import("../src/index.js");
    const r = c({ home_page_url: "https://blog.example/", items: [item(`<img src="uploads/2025/gone.jpg">\n\nText.`)] }, "UTC");
    expect(r.media[0]!.url).toBe("https://blog.example/uploads/2025/gone.jpg");
    unlinkMedia(r, r.media[0]!);
    expect(r.posts[0]!.line.text).toBe("![](https://blog.example/uploads/2025/gone.jpg)");
    expect(r.media).toEqual([]);
  });
});
