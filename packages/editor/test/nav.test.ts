import { describe, expect, it } from "vitest";
import { buildSite, type ContentSource } from "@porridge/core";
import { linkProblem, readNav, writeNav } from "../src/model/nav.js";
import { fileFromOpml, fileToOpml, type EFile } from "../src/model/tree.js";

const NS = `xmlns:porridge="https://github.com/alexjj/porridge"`;
const blogText = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0" ${NS}>
  <head>
    <title>T</title>
    <porridge:baseUrl>https://e.com/</porridge:baseUrl>
    <porridge:navLink url="https://github.com/me" navOrder="50">GitHub</porridge:navLink>
    <porridge:language>en</porridge:language>
  </head>
  <body/>
</opml>
`;
const pageText = (title: string, order: string) => `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0" ${NS}>
  <head>
    <title>${title}</title>
    <porridge:inNav>true</porridge:inNav>
    <porridge:navOrder>${order}</porridge:navOrder>
  </head>
  <body/>
</opml>
`;

function files(): Record<string, EFile> {
  return {
    "blog.opml": fileFromOpml("blog.opml", blogText),
    "pages/about.opml": fileFromOpml("pages/about.opml", pageText("About", "1")),
    "pages/now.opml": fileFromOpml("pages/now.opml", pageText("Now", "100")),
  };
}

const labels = (f: Record<string, EFile>) => readNav(f).map((e) => e.label);

describe("navigation in Blog settings", () => {
  it("reads pages, links and the archive in the site's order", () => {
    expect(labels(files())).toEqual(["About", "GitHub", "Now", "Archive"]);
  });

  it("writes a new order that the builder agrees with", async () => {
    const f = files();
    const entries = readNav(f);
    // Archive first, then Now, GitHub, About.
    const changed = writeNav(f, [entries[3]!, entries[2]!, { ...entries[1]!, label: "Code" } as never, entries[0]!]);
    expect(changed.sort()).toEqual(["blog.opml", "pages/about.opml", "pages/now.opml"]);
    expect(labels(f)).toEqual(["Archive", "Now", "Code", "About"]);
    const blog = fileToOpml(f["blog.opml"]!);
    // The link stays where it was in <head>.
    expect(blog).toContain(`<porridge:baseUrl>https://e.com/</porridge:baseUrl>
    <porridge:navLink url="https://github.com/me" navOrder="30">Code</porridge:navLink>
    <porridge:language>en</porridge:language>
    <porridge:archiveNavOrder>10</porridge:archiveNavOrder>`);

    const texts: Record<string, string> = Object.fromEntries(Object.entries(f).map(([p, file]) => [p, fileToOpml(file)]));
    const source: ContentSource = { read: async (p) => texts[p], list: async () => ["about.opml", "now.opml"] };
    const { site } = await buildSite(source);
    expect(site.nav.map((i) => i.label)).toEqual(["Archive", "Now", "Code", "About"]);
  });

  it("needs no archive setting when the archive is last", () => {
    const f = files();
    writeNav(f, readNav(f));
    expect(fileToOpml(f["blog.opml"]!)).not.toContain("archiveNavOrder");
  });

  it("explains a bad link", () => {
    expect(linkProblem("", "https://e.com")).toBe("Give it a label.");
    expect(linkProblem("X", "e.com")).toMatch(/^Not a web address/);
    expect(linkProblem("X", "/now/")).toBe("");
  });
});
