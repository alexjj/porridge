import { describe, expect, it } from "vitest";
import { createInlineRenderer } from "../src/index.js";

describe("inline markdown", () => {
  const md = createInlineRenderer("/my-blog/");

  it("renders inline markdown without wrapping paragraphs", () => {
    expect(md.html("**bold** and *it* and `code`")).toBe("<strong>bold</strong> and <em>it</em> and <code>code</code>");
  });

  it("rewrites root-relative links and images to the prefix", () => {
    expect(md.html("[a](/2026/11/18/#a1) ![](/images/x.jpg)")).toBe(
      `<a href="/my-blog/2026/11/18/#a1">a</a> <img src="/my-blog/images/x.jpg" alt="">`,
    );
  });

  it("leaves absolute, protocol-relative and relative URLs alone", () => {
    expect(md.html("[a](https://x.com/) [b](//cdn.x/y) [c](page/)")).toBe(
      `<a href="https://x.com/">a</a> <a href="//cdn.x/y">b</a> <a href="page/">c</a>`,
    );
  });

  it("can rewrite to an absolute base for RSS", () => {
    expect(createInlineRenderer("https://e.com/b/").html("![](/images/x.jpg)")).toBe(
      `<img src="https://e.com/b/images/x.jpg" alt="">`,
    );
  });

  it("can use a separate prefix for images", () => {
    expect(createInlineRenderer("https://blog.example/", "https://raw.example/main/").html("[a](/x/) ![](/images/x.jpg)")).toBe(
      `<a href="https://blog.example/x/">a</a> <img src="https://raw.example/main/images/x.jpg" alt="">`,
    );
  });

  it("captions images with their description", () => {
    expect(md.html("![A big stack of notebooks](/images/2026/11/notebooks.jpg)")).toBe(
      `<span class="figure"><img src="/my-blog/images/2026/11/notebooks.jpg" alt="A big stack of notebooks">` +
        `<span class="caption" aria-hidden="true">A big stack of notebooks</span></span>`,
    );
    expect(md.html("![*Stacked* & <tall>](/x.jpg)")).toContain(
      `<span class="caption" aria-hidden="true">Stacked &amp; &lt;tall&gt;</span>`,
    );
  });

  it("allows inline HTML and autolinks", () => {
    expect(md.html("<mark>hi</mark> <https://e.com>")).toBe(`<mark>hi</mark> <a href="https://e.com">https://e.com</a>`);
  });

  it("produces plain text for titles", () => {
    expect(md.plain("A **bold** [link](/x) with `code` and ![alt](/i.jpg)")).toBe("A bold link with code and alt");
  });
});
