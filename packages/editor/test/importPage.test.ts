import { describe, expect, it } from "vitest";
import { pageFromOpml } from "../src/model/importPage.js";
import type { ENode } from "../src/model/tree.js";

const show = (nodes: ENode[], depth = 0): string[] =>
  nodes.flatMap((n) => [`${"  ".repeat(depth)}${n.text}${Object.keys(n.attrs).filter((k) => k !== "text").map((k) => ` [${k}=${n.attrs[k]}]`).join("")}`, ...show(n.children, depth + 1)]);

describe("importing an OPML file as a page", () => {
  it("keeps the outline and takes the title from the head", () => {
    const { title, nodes } = pageFromOpml(
      `<opml version="2.0"><head><title>Books I liked</title></head><body>
        <outline text="Fiction" created="Wed, 18 Nov 2026 12:00:00 GMT"><outline text="*Middlemarch*"/><outline text="Secret" isComment="true"/></outline>
      </body></opml>`,
      "books.opml",
    );
    expect(title).toBe("Books I liked");
    expect(show(nodes)).toEqual(["Fiction [created=Wed, 18 Nov 2026 12:00:00 GMT]", "  *Middlemarch*", "  Secret [isComment=true]"]);
  });

  it("uses the file name when there's no title", () => {
    expect(pageFromOpml(`<opml version="2.0"><head/><body><outline text="x"/></body></opml>`, "Reading list.opml").title).toBe("Reading list");
  });

  it("turns notes into lines, Drummer links into links, and drops calendar types and empty lines", () => {
    const { nodes } = pageFromOpml(
      `<opml version="2.0"><head/><body>
        <outline text="Idea" _note="First line of the note&#10;&#10;Second line"><outline text="Child"/></outline>
        <outline text="My site" type="link" url="https://e.com/"/>
        <outline text="November 2026" type="calendarMonth" date="2026-11"><outline text="Old post"/></outline>
        <outline text=""/>
      </body></opml>`,
      "x.opml",
    );
    expect(show(nodes)).toEqual([
      "Idea",
      "  First line of the note",
      "  Second line",
      "  Child",
      "[My site](https://e.com/)",
      "November 2026 [date=2026-11]",
      "  Old post",
    ]);
  });

  it("explains files it can't use", () => {
    expect(() => pageFromOpml("not xml at all", "notes.txt")).toThrow(/^notes\.txt isn't an OPML file/);
    expect(() => pageFromOpml(`<opml version="2.0"><head/><body/></opml>`, "empty.opml")).toThrow("empty.opml has no outline in it.");
  });
});
