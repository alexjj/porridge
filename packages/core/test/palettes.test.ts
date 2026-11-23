import { describe, expect, it } from "vitest";
import { buildSite, parsePalette, STYLESHEET, THEMES, type ContentSource } from "../src/index.js";

function memorySource(files: Record<string, string>): ContentSource {
  return { read: async (p) => files[p], list: async () => [] };
}

const blog = (head: string) => `<opml version="2.0" xmlns:porridge="https://github.com/alexjj/porridge"><head><title>T</title>
<porridge:baseUrl>https://e.com/</porridge:baseUrl>${head}</head><body/></opml>`;

async function build(head: string) {
  const { files, site } = await buildSite(memorySource({ "blog.opml": blog(head) }));
  const file = (p: string) => files.find((f) => f.path === p)!.content;
  return { site, css: file("style.css"), home: file("index.html") };
}

describe("colour themes", () => {
  it("has the default and five presets, each light and dark", () => {
    expect(THEMES.map((t) => t.name)).toEqual(["porridge", "solarized", "nord", "gruvbox", "catppuccin", "rose-pine"]);
  });

  it("leaves the stylesheet alone for the default", async () => {
    const { css, site } = await build("");
    expect(css).toBe(STYLESHEET);
    expect(site.warnings).toEqual([]);
  });

  it("adds a preset's colours, light and dark, and changes the stylesheet's version", async () => {
    const plain = await build("");
    const nord = await build("<porridge:theme>nord</porridge:theme>");
    expect(nord.css.startsWith(STYLESHEET)).toBe(true);
    expect(nord.css).toContain(":root { --bg: #eceff4; --text: #2e3440;");
    expect(nord.css).toContain("@media (prefers-color-scheme: dark) {\n  :root { --bg: #2e3440; --text: #eceff4;");
    const version = (html: string) => /style\.css\?v=([0-9a-f]{8})/.exec(html)![1];
    expect(version(nord.home)).not.toBe(version(plain.home));
  });

  it("uses custom colours, falling back to the default for any not given", async () => {
    const { css, site } = await build(
      "<porridge:theme>custom</porridge:theme><porridge:colors>bg: #ffffff; link: rgb(10, 20, 30)</porridge:colors><porridge:darkColors>text: #fafafa</porridge:darkColors>",
    );
    expect(site.settings.theme.light).toEqual({ ...THEMES[0]!.light, bg: "#ffffff", link: "rgb(10, 20, 30)" });
    expect(site.settings.theme.dark).toEqual({ ...THEMES[0]!.dark, text: "#fafafa" });
    expect(css).toContain("--bg: #ffffff;");
  });

  it("warns about unknown themes and unsafe or unknown colours", async () => {
    const unknown = await build("<porridge:theme>neon</porridge:theme>");
    expect(unknown.site.warnings.map((w) => w.message)).toEqual([`Unknown colour theme "neon", using the default.`]);
    expect(unknown.css).toBe(STYLESHEET);

    const bad = await build("<porridge:theme>custom</porridge:theme><porridge:colors>bg: red; } body { display: none; text: #000; sparkle: #fff</porridge:colors>");
    expect(bad.site.warnings.map((w) => w.message)).toEqual([
      `porridge:colors: unknown colour "} body { display"; using the default for it.`,
      `porridge:colors: unknown colour "sparkle"; using the default for it.`,
    ]);
    expect(bad.css).not.toContain("display: none");
  });

  it("parses and checks colour lists", () => {
    expect(parsePalette("bg: #fff; muted: hsl(30 10% 50%); link-hover: oklch(0.6 0.1 40)").palette).toEqual({
      bg: "#fff",
      muted: "hsl(30 10% 50%)",
      "link-hover": "oklch(0.6 0.1 40)",
    });
    expect(parsePalette("bg: url(x.png)").problems).toEqual([`"url(x.png)" isn't a colour`]);
    expect(parsePalette("text: #000; } :root { x").problems).toEqual([`unknown colour "}"`]);
  });
});
