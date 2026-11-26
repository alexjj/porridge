import { describe, expect, it } from "vitest";
import { buildSite, faviconSvg, iconProblem, ICON_CHOICES, type ContentSource } from "../src/index.js";

async function build(head: string) {
  const files: Record<string, string> = {
    "blog.opml": `<opml version="2.0" xmlns:porridge="https://github.com/alexjj/porridge"><head><title>T</title>
<porridge:baseUrl>https://e.com/b/</porridge:baseUrl>${head}</head><body/></opml>`,
  };
  const source: ContentSource = { read: async (p) => files[p], list: async () => [] };
  const { files: out, site } = await buildSite(source);
  const file = (p: string) => out.find((f) => f.path === p)?.content;
  return { site, icon: file("favicon.svg"), home: file("index.html")! };
}

describe("site icon", () => {
  it("is a bowl of porridge by default, linked from every page", async () => {
    const { icon, home, site } = await build("");
    expect(icon).toBe(faviconSvg("🥣"));
    expect(icon).toContain(">🥣</text>");
    expect(home).toMatch(/<link rel="icon" href="\/b\/favicon\.svg\?v=[0-9a-f]{8}" type="image\/svg\+xml">/);
    expect(site.warnings).toEqual([]);
  });

  it("uses the chosen emoji, and its link changes with it", async () => {
    const plain = await build("");
    const owl = await build("<porridge:icon>🦉</porridge:icon>");
    expect(owl.icon).toContain(">🦉</text>");
    const version = (html: string) => /favicon\.svg\?v=(\w+)/.exec(html)![1];
    expect(version(owl.home)).not.toBe(version(plain.home));
  });

  it("keeps emoji made of several code points whole", async () => {
    for (const e of ["❤️", "👩🏽‍💻", "🏳️‍🌈", "🇬🇧"]) expect(iconProblem(e)).toBeUndefined();
    for (const e of ICON_CHOICES) expect(iconProblem(e)).toBeUndefined();
  });

  it("warns about more than one emoji, and escapes what it draws", async () => {
    const two = await build("<porridge:icon>🥣🥣</porridge:icon>");
    expect(two.site.warnings.map((w) => w.message)).toEqual([`porridge:icon: "🥣🥣" isn't a single emoji; using 🥣.`]);
    expect(two.icon).toBe(faviconSvg("🥣"));
    expect(faviconSvg("<")).toContain(">&lt;</text>");
  });
});
