import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { headValue, OpmlParseError, parseOpml, serializeOpml } from "../src/index.js";

const repo = join(import.meta.dirname, "../../..");

function opmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return opmlFiles(path);
    return name.endsWith(".opml") ? [path] : [];
  });
}

const wellFormed = [...opmlFiles(join(repo, "fixtures")), ...opmlFiles(join(repo, "template"))].filter(
  (p) => !p.includes("malformed-xml/blog/"),
);

describe("round trip", () => {
  it.each(wellFormed.map((p) => [relative(repo, p), p]))("%s comes back byte-identical", (_name, path) => {
    const source = readFileSync(path, "utf8");
    expect(serializeOpml(parseOpml(source))).toBe(source);
  });
});

describe("parseOpml", () => {
  it("keeps attribute order and unknown attributes", () => {
    const doc = parseOpml(
      `<opml version="2.0"><head/><body><outline z="1" text="a" a="2" x:y="3" xmlns:x="urn:x"/></body></opml>`,
    );
    expect([...doc.body[0]!.attrs.keys()]).toEqual(["z", "text", "a", "x:y", "xmlns:x"]);
  });

  it("decodes entities and character references", () => {
    const doc = parseOpml(`<opml version="2.0"><body><outline text="&lt;b&gt; &amp; &quot;q&quot; line&#10;two"/></body></opml>`);
    expect(doc.body[0]!.attrs.get("text")).toBe(`<b> & "q" line\ntwo`);
  });

  it("escapes what it needs to when writing", () => {
    const doc = parseOpml(`<opml version="2.0"><body><outline text="&lt;b&gt; &amp; &quot;q&quot; it's line&#10;two"/></body></opml>`);
    expect(serializeOpml(doc)).toContain(`<outline text="&lt;b&gt; &amp; &quot;q&quot; it's line&#10;two"/>`);
  });

  it("reports malformed XML with a line number", () => {
    const source = readFileSync(join(repo, "fixtures/errors/malformed-xml/blog/2026.opml"), "utf8");
    expect(() => parseOpml(source)).toThrow(OpmlParseError);
    try {
      parseOpml(source);
    } catch (err) {
      expect((err as OpmlParseError).line).toBeGreaterThan(0);
    }
  });

  it("rejects files that aren't OPML", () => {
    expect(() => parseOpml(`<rss/>`)).toThrow(/root element must be <opml>/);
    expect(() => parseOpml(`<opml><head/></opml>`)).toThrow(/missing <body>/);
  });
});

describe("headValue", () => {
  it("matches Porridge settings by namespace URI, not prefix", () => {
    const doc = parseOpml(
      `<opml version="2.0" xmlns:pg="https://github.com/alexjj/porridge" xmlns:porridge="urn:other">
        <head><title>T</title><pg:homeDays>5</pg:homeDays><porridge:homeDays>9</porridge:homeDays></head><body/></opml>`,
    );
    expect(headValue(doc, "title")).toBe("T");
    expect(headValue(doc, "porridge:homeDays")).toBe("5");
  });
});
