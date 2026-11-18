import { describe, expect, it } from "vitest";
import { createInlineRenderer } from "../src/index.js";

describe("inline markdown", () => {
  const md = createInlineRenderer("/my-blog/");

  it("renders inline markdown without wrapping paragraphs", () => {
    expect(md.html("**bold** and *it* and `code`")).toBe("<strong>bold</strong> and <em>it</em> and <code>code</code>");
  });

  it("rewrites root-relative links and images to the prefix", () => {
    expect(md.html("[a](/2026/11/18/#a1) ![i](/images/x.jpg)")).toBe(
      `<a href="/my-blog/2026/11/18/#a1">a</a> <img src="/my-blog/images/x.jpg" alt="i">`,
    );
  });

  it("leaves absolute, protocol-relative and relative URLs alone", () => {
    expect(md.html("[a](https://x.com/) [b](//cdn.x/y) [c](page/)")).toBe(
      `<a href="https://x.com/">a</a> <a href="//cdn.x/y">b</a> <a href="page/">c</a>`,
    );
  });

  it("can rewrite to an absolute base for RSS", () => {
    expect(createInlineRenderer("https://e.com/b/").html("![i](/images/x.jpg)")).toBe(
      `<img src="https://e.com/b/images/x.jpg" alt="i">`,
    );
  });

  it("allows inline HTML and autolinks", () => {
    expect(md.html("<mark>hi</mark> <https://e.com>")).toBe(`<mark>hi</mark> <a href="https://e.com">https://e.com</a>`);
  });

  it("produces plain text for titles", () => {
    expect(md.plain("A **bold** [link](/x) with `code` and ![alt](/i.jpg)")).toBe("A bold link with code and alt");
  });
});
