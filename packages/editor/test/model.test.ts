import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addEntry, dayOf, ensureEntryTimes, uniqueCreated } from "../src/model/calendar.js";
import { indent, mergeUp, move, neighbour, outdent, pasteOutline, remove, split, visible, type Tree } from "../src/model/ops.js";
import { fileFromOpml, fileToOpml, newNode, type EFile, type ENode } from "../src/model/tree.js";

const repo = join(import.meta.dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

/** Build a tree from an indented sketch: two spaces per level, `#` for a day, `_` for empty. */
function sketch(text: string): ENode[] {
  const roots: ENode[] = [];
  const stack: { depth: number; node: ENode }[] = [];
  for (const line of text.split("\n").filter((l) => l.trim())) {
    const depth = line.search(/\S/) / 2;
    const raw = line.trim();
    const node = raw.startsWith("#")
      ? newNode(raw.slice(1), { type: "calendarDay", date: "2026-11-18" })
      : newNode(raw === "_" ? "" : raw);
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    (stack.length ? stack[stack.length - 1]!.node.children : roots).push(node);
    stack.push({ depth, node });
  }
  return roots;
}

function draw(nodes: ENode[], depth = 0): string {
  return nodes.map((n) => "  ".repeat(depth) + n.text + "\n" + draw(n.children, depth + 1)).join("");
}

const find = (nodes: ENode[], text: string): ENode => {
  for (const n of nodes) {
    if (n.text === text) return n;
    const inner = n.children.length ? find(n.children, text) : undefined;
    if (inner) return inner;
  }
  return undefined as unknown as ENode;
};

function setup(text: string, collapsed: string[] = []) {
  const roots = sketch(text);
  const tree: Tree = { roots, collapsed: new Set(collapsed.map((t) => find(roots, t).id)), zoom: null };
  return { roots, tree, id: (t: string) => find(roots, t).id };
}

describe("round trip through the editor model", () => {
  it.each(["fixtures/sample-blog/blog/2026.opml", "fixtures/sample-blog/blog/2025.opml", "fixtures/sample-blog/pages/about.opml", "template/blog.opml"])(
    "%s is unchanged",
    (p) => expect(fileToOpml(fileFromOpml(p, read(p)))).toBe(read(p)),
  );

  it("writes edited text into the text attribute in place", () => {
    const f = fileFromOpml("x.opml", `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <body>\n    <outline created="c" text="old" z="1"/>\n  </body>\n</opml>\n`);
    f.nodes[0]!.text = "new";
    expect(fileToOpml(f)).toContain(`<outline created="c" text="new" z="1"/>`);
  });
});

describe("split (Enter)", () => {
  it("splits text at the caret into a new sibling", () => {
    const { roots, tree, id } = setup("hello world\nnext");
    const focus = split(tree, id("hello world"), 5)!;
    expect(draw(roots)).toBe("hello\n world\nnext\n");
    expect(focus).toEqual({ id: find(roots, " world").id, caret: 0 });
  });

  it("opens a line above when the caret is at the start", () => {
    const { roots, tree, id } = setup("a\nb");
    const b = id("b");
    expect(split(tree, b, 0)).toEqual({ id: b, caret: 0 });
    expect(draw(roots)).toBe("a\n\nb\n");
  });

  it("puts the new line first among visible children", () => {
    const { roots, tree, id } = setup("parent\n  child");
    split(tree, id("parent"), 6);
    expect(draw(roots)).toBe("parent\n  \n  child\n");
  });

  it("puts the new line after a collapsed node", () => {
    const { roots, tree, id } = setup("parent\n  child", ["parent"]);
    split(tree, id("parent"), 6);
    expect(draw(roots)).toBe("parent\n  child\n\n");
  });

  it("does nothing to calendar nodes", () => {
    const { tree, id } = setup("#day\n  entry");
    expect(split(tree, id("day"), 1)).toBeNull();
  });
});

describe("mergeUp (Backspace at start)", () => {
  it("joins onto the previous node and keeps the caret at the join", () => {
    const { roots, tree, id } = setup("abc\ndef");
    const abc = id("abc");
    expect(mergeUp(tree, id("def"))).toEqual({ id: abc, caret: 3 });
    expect(draw(roots)).toBe("abcdef\n");
  });

  it("moves children to the previous node", () => {
    const { roots, tree, id } = setup("a\n  a1\nb\n  b1");
    // a1 is the previous visible node, so b joins onto it and b1 follows.
    mergeUp(tree, id("b"));
    expect(draw(roots)).toBe("a\n  a1b\n    b1\n");
  });

  it("joins a first child into its parent, keeping its children in place", () => {
    const { roots, tree, id } = setup("p\n  c\n    gc\n  d");
    mergeUp(tree, id("c"));
    expect(draw(roots)).toBe("pc\n  gc\n  d\n");
  });

  it("removes an empty first entry under a day and focuses the next one", () => {
    const { roots, tree, id } = setup("#day\n  _\n  second");
    const empty = roots[0]!.children[0]!.id;
    expect(mergeUp(tree, empty)).toEqual({ id: id("second"), caret: 0 });
    expect(draw(roots)).toBe("day\n  second\n");
  });

  it("won't merge into a calendar node", () => {
    const { tree, id } = setup("#day\n  text");
    expect(mergeUp(tree, id("text"))).toBeNull();
  });
});

describe("indent, outdent and move", () => {
  it("indents under the previous sibling, expanding it", () => {
    const { roots, tree, id } = setup("a\n  a1\nb", ["a"]);
    expect(indent(tree, id("b"))).toBe(true);
    expect(draw(roots)).toBe("a\n  a1\n  b\n");
    expect(tree.collapsed.has(id("a"))).toBe(false);
  });

  it("can't indent the first child", () => {
    const { tree, id } = setup("a\n  a1");
    expect(indent(tree, id("a1"))).toBe(false);
  });

  it("outdents to after the parent, leaving later siblings behind", () => {
    const { roots, tree, id } = setup("p\n  x\n  y\nq");
    expect(outdent(tree, id("x"))).toBe(true);
    expect(draw(roots)).toBe("p\n  y\nx\nq\n");
  });

  it("won't outdent an entry out of its day, or out of the zoomed node", () => {
    const day = setup("#day\n  entry");
    expect(outdent(day.tree, day.id("entry"))).toBe(false);
    const z = setup("p\n  c");
    z.tree.zoom = find(z.roots, "p");
    expect(outdent(z.tree, z.id("c"))).toBe(false);
  });

  it("moves among siblings only", () => {
    const { roots, tree, id } = setup("a\nb\nc");
    expect(move(tree, id("c"), -1)).toBe(true);
    expect(draw(roots)).toBe("a\nc\nb\n");
    expect(move(tree, id("a"), -1)).toBe(false);
    expect(move(tree, id("b"), 1)).toBe(false);
  });
});

describe("remove, navigation and paste", () => {
  it("removes a subtree and focuses the previous node", () => {
    const { roots, tree, id } = setup("a\nb\n  b1\nc");
    expect(remove(tree, id("b"))).toEqual({ id: id("a"), caret: 1 });
    expect(draw(roots)).toBe("a\nc\n");
  });

  it("focuses the next node outside the subtree when removing the first", () => {
    const { tree, id } = setup("a\n  a1\nb");
    expect(remove(tree, id("a"))).toEqual({ id: id("b"), caret: 0 });
  });

  it("skips collapsed and calendar nodes when navigating", () => {
    const { tree, id } = setup("a\n  hidden\n#day\n  e1", ["a"]);
    expect(visible(tree).map((n) => n.text)).toEqual(["a", "day", "e1"]);
    expect(neighbour(tree, id("e1"), -1)?.text).toBe("a");
  });

  it("pastes several lines as siblings", () => {
    const { roots, tree, id } = setup("startEND");
    const focus = pasteOutline(tree, id("startEND"), 5, 5, ["1", "2", "3"].map((text) => ({ text, depth: 0 })))!;
    expect(draw(roots)).toBe("start1\n2\n3END\n");
    expect(focus.caret).toBe(1);
  });
});

describe("calendar", () => {
  const files = (): Record<string, EFile> => ({
    "blog.opml": fileFromOpml("blog.opml", read("fixtures/sample-blog/blog.opml")),
    "blog/2026.opml": fileFromOpml("blog/2026.opml", read("fixtures/sample-blog/blog/2026.opml")),
    "blog/2025.opml": fileFromOpml("blog/2025.opml", read("fixtures/sample-blog/blog/2025.opml")),
  });

  it("adds an entry at the top of an existing day", () => {
    const fs = files();
    const r = addEntry(fs, new Date("2026-11-18T22:00:00Z"));
    expect(r.path).toBe("blog/2026.opml");
    expect(r.changed).toEqual(["blog/2026.opml"]);
    const day = fs["blog/2026.opml"]!.nodes[0]!.children[0]!;
    expect(day.children[0]!.id).toBe(r.id);
    expect(day.children[0]!.attrs.created).toBe("Wed, 18 Nov 2026 22:00:00 GMT");
  });

  it("reuses an empty entry already at the top", () => {
    const fs = files();
    const a = addEntry(fs, new Date("2026-11-18T22:00:00Z"));
    const b = addEntry(fs, new Date("2026-11-18T22:05:00Z"));
    expect(b.id).toBe(a.id);
  });

  it("creates the day and month in newest-first position", () => {
    const fs = files();
    addEntry(fs, new Date("2026-08-20T09:00:00Z"));
    const months = fs["blog/2026.opml"]!.nodes.map((m) => m.attrs.date);
    expect(months).toEqual(["2026-11", "2026-10", "2026-09", "2026-08", "2026-07"]);
    const aug = fs["blog/2026.opml"]!.nodes[3]!;
    expect(aug.text).toBe("August 2026");
    expect(aug.children[0]!.text).toBe("20th August");

    addEntry(fs, new Date("2026-11-03T09:00:00Z"));
    expect(fs["blog/2026.opml"]!.nodes[0]!.children.map((d) => d.attrs.date)).toEqual([
      "2026-11-18",
      "2026-11-17",
      "2026-11-03",
      "2026-11-02",
    ]);
  });

  it("uses the blog's timezone to pick the day", () => {
    const fs = files();
    // 23:30 GMT on 15 July is 00:30 BST on the 16th.
    const r = addEntry(fs, new Date("2026-07-15T23:30:00Z"));
    expect(dayOf(fs[r.path]!, r.id)).toBe("2026-07-16");
  });

  it("creates a new year file and include, newest first", () => {
    const fs = files();
    const r = addEntry(fs, new Date("2027-01-01T10:00:00Z"));
    expect(r.path).toBe("blog/2027.opml");
    expect(r.changed.sort()).toEqual(["blog.opml", "blog/2027.opml"]);
    expect(fs["blog.opml"]!.nodes.map((n) => n.attrs.url)).toEqual(["blog/2027.opml", "blog/2026.opml", "blog/2025.opml"]);
    expect(fileToOpml(fs["blog/2027.opml"]!)).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0" xmlns:porridge="https://github.com/alexjj/porridge">
  <head>
    <title>2027</title>
  </head>
  <body>
    <outline text="January 2027" type="calendarMonth" date="2027-01">
      <outline text="1st January" type="calendarDay" date="2027-01-01">
        <outline text="" created="Fri, 01 Jan 2027 10:00:00 GMT"/>
      </outline>
    </outline>
  </body>
</opml>
`);
  });

  it("gives entries unique anchors within a day", () => {
    const day = newNode("d", { type: "calendarDay", date: "2026-11-18" });
    day.children.push(newNode("x", { created: "Wed, 18 Nov 2026 10:00:00 GMT" }));
    day.children.push(newNode("y", { created: "Wed, 18 Nov 2026 10:00:01 GMT" }));
    expect(uniqueCreated(day, new Date("2026-11-18T10:00:00.700Z"), "UTC")).toBe("Wed, 18 Nov 2026 10:00:02 GMT");
  });

  it("gives a created time to new entries made by Enter", () => {
    const fs = files();
    const file = fs["blog/2026.opml"]!;
    const day = file.nodes[0]!.children[1]!; // 17th November
    day.children.push(newNode("made by Enter"));
    expect(ensureEntryTimes(file, new Date("2026-11-18T20:00:00Z"), "Europe/London")).toBe(true);
    // 20:00:00 is taken by an entry on the 17th, so it moves on a second.
    expect(day.children.at(-1)!.attrs.created).toBe("Wed, 18 Nov 2026 20:00:01 GMT");
    expect(ensureEntryTimes(file, new Date(), "Europe/London")).toBe(false);
  });
});

describe("head settings", () => {
  it("sets, adds and removes settings, matching the namespace by URI", async () => {
    const { setHead, fileHead } = await import("../src/model/tree.js");
    const f = fileFromOpml(
      "p.opml",
      `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0" xmlns:pg="https://github.com/alexjj/porridge">\n  <head>\n    <title>Old</title>\n  </head>\n  <body/>\n</opml>\n`,
    );
    setHead(f, "title", "New");
    setHead(f, "porridge:inNav", "true");
    expect(fileHead(f, "porridge:inNav")).toBe("true");
    expect(fileToOpml(f)).toContain(`<title>New</title>\n    <pg:inNav>true</pg:inNav>`);
    setHead(f, "porridge:inNav", "");
    expect(fileToOpml(f)).not.toContain("inNav");
  });

  it("declares the namespace when a file has none", async () => {
    const { setHead } = await import("../src/model/tree.js");
    const f = fileFromOpml("p.opml", `<opml version="2.0"><head/><body/></opml>`);
    setHead(f, "porridge:navOrder", "2");
    expect(fileToOpml(f)).toContain(`<opml version="2.0" xmlns:porridge="https://github.com/alexjj/porridge">`);
    expect(fileToOpml(f)).toContain(`<porridge:navOrder>2</porridge:navOrder>`);
  });

  it("makes page names from titles", async () => {
    const { slugify } = await import("../src/model/tree.js");
    expect(slugify("My Book Notes!")).toBe("my-book-notes");
    expect(slugify("Café & Crêpes")).toBe("cafe-crepes");
    expect(slugify("2026 reading")).toBe("page-2026-reading");
    expect(slugify("!!!")).toBe("page");
  });
});

describe("images", async () => {
  const { imagePath, keepAsIs, preferOriginal, suggestAlt, targetSize } = await import("../src/model/images.js");

  it("scales the long edge down to 2000px, never up", () => {
    expect(targetSize(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(targetSize(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("keeps GIFs and SVGs exactly as they are", () => {
    expect(keepAsIs("image/gif")).toBe(true);
    expect(keepAsIs("image/svg+xml")).toBe(true);
    expect(keepAsIs("image/jpeg")).toBe(false);
  });

  it("uses the WebP unless the original is a small web image that's no bigger", () => {
    // A big phone photo: always the resized WebP.
    expect(preferOriginal("image/jpeg", 3_000_000, 4032, 3024, 400_000)).toBe(false);
    // A small JPEG the WebP doesn't improve on: keep it.
    expect(preferOriginal("image/jpeg", 90_000, 1200, 800, 120_000)).toBe(true);
    // …but if the WebP is smaller, use the WebP.
    expect(preferOriginal("image/jpeg", 200_000, 1200, 800, 120_000)).toBe(false);
    // Formats browsers can't show are always converted.
    expect(preferOriginal("image/heic", 50_000, 800, 600, 90_000)).toBe(false);
    // Too wide, or too heavy, even if the WebP is bigger.
    expect(preferOriginal("image/png", 50_000, 2400, 800, 90_000)).toBe(false);
    expect(preferOriginal("image/png", 900_000, 800, 600, 990_000)).toBe(false);
  });

  it("files images by month with collision-proof names", () => {
    expect(imagePath("My Porridge Bowl.HEIC", "2026-11-18", "193005", "jpg")).toBe("images/2026/11/my-porridge-bowl-18193005.jpg");
    expect(imagePath("IMG_2041.jpg", "2026-01-02", "080000", "jpg")).toBe("images/2026/01/img-2041-02080000.jpg");
    expect(imagePath("😀.png", "2026-01-02", "080000", "png")).toBe("images/2026/01/photo-02080000.png");
  });

  it("suggests alt text only from meaningful file names", () => {
    expect(suggestAlt("porridge-bowl.png")).toBe("porridge bowl");
    expect(suggestAlt("IMG_2041.jpg")).toBe("");
    expect(suggestAlt("PXL_20261118_193005.jpg")).toBe("");
  });
});

describe("zoomed-in title", async () => {
  const { splitIntoFirstChild } = await import("../src/model/ops.js");
  it("Enter moves the rest of the title into a new first child", () => {
    const { roots, tree, id } = setup("titletail\n  child");
    expect(splitIntoFirstChild(tree, id("titletail"), 5)).toEqual({ id: find(roots, "tail").id, caret: 0 });
    expect(draw(roots)).toBe("title\n  tail\n  child\n");
  });
});

describe("selecting several lines", async () => {
  const { block, indentBlock, outdentBlock, moveBlock, removeBlock } = await import("../src/model/ops.js");
  const sel = (t: ReturnType<typeof setup>, a: string, h: string) => block(t.tree, t.id(a), t.id(h));
  const names = (b: NonNullable<ReturnType<typeof block>>) => b.list.slice(b.start, b.end + 1).map((n) => n.text);

  it("selects a run of siblings in either direction", () => {
    const t = setup("a\nb\nc\nd");
    expect(names(sel(t, "b", "c")!)).toEqual(["b", "c"]);
    expect(names(sel(t, "d", "b")!)).toEqual(["b", "c", "d"]);
    expect(names(sel(t, "c", "c")!)).toEqual(["c"]);
  });

  it("widens to whole lines at the common level", () => {
    const t = setup("a\n  a1\n  a2\nb\n  b1\nc");
    expect(names(sel(t, "a2", "b1")!)).toEqual(["a", "b"]);
    expect(names(sel(t, "a", "a2")!)).toEqual(["a"]);
    expect(names(sel(t, "a1", "a2")!)).toEqual(["a1", "a2"]);
  });

  it("won't select calendar headings", () => {
    const t = setup("#day\n  e1\n  e2\n#day2\n  e3");
    expect(names(sel(t, "e1", "e2")!)).toEqual(["e1", "e2"]);
    expect(sel(t, "e1", "e3")).toBeNull();
  });

  it("stays inside the zoomed-in line", () => {
    const t = setup("p\n  c1\n  c2\nq");
    t.tree.zoom = find(t.roots, "p");
    expect(names(sel(t, "c1", "c2")!)).toEqual(["c1", "c2"]);
    expect(sel(t, "c1", "q")).toBeNull();
  });

  it("indents, outdents, moves and deletes them together", () => {
    const t = setup("a\nb\nc\nd");
    expect(indentBlock(t.tree, sel(t, "b", "c")!)).toBe(true);
    expect(draw(t.roots)).toBe("a\n  b\n  c\nd\n");
    expect(outdentBlock(t.tree, sel(t, "b", "c")!)).toBe(true);
    expect(draw(t.roots)).toBe("a\nb\nc\nd\n");
    expect(moveBlock(sel(t, "b", "c")!, -1)).toBe(true);
    expect(draw(t.roots)).toBe("b\nc\na\nd\n");
    expect(moveBlock(sel(t, "b", "c")!, -1)).toBe(false);
    expect(moveBlock(sel(t, "b", "c")!, 1)).toBe(true);
    expect(draw(t.roots)).toBe("a\nb\nc\nd\n");
    expect(indentBlock(t.tree, sel(t, "a", "b")!)).toBe(false);
    expect(removeBlock(sel(t, "b", "d")!)).toBe(true);
    expect(draw(t.roots)).toBe("a\n");
  });

  it("outdents children, leaving later siblings behind", () => {
    const t = setup("p\n  x\n  y\n  z\nq");
    expect(outdentBlock(t.tree, sel(t, "x", "y")!)).toBe(true);
    expect(draw(t.roots)).toBe("p\n  z\nx\ny\nq\n");
  });

  it("won't take entries out of their day", () => {
    const t = setup("#day\n  e1\n  e2");
    expect(outdentBlock(t.tree, sel(t, "e1", "e2")!)).toBe(false);
  });
});

describe("pasting a link onto selected text", async () => {
  const { pastedLink, linkMarkdown } = await import("../src/store/commands.js");
  it("recognises addresses and Markdown links", () => {
    expect(pastedLink("https://www.google.com")).toBe("https://www.google.com");
    expect(pastedLink("  http://example.com/a?b=c  ")).toBe("http://example.com/a?b=c");
    expect(pastedLink("www.google.com")).toBe("https://www.google.com");
    expect(pastedLink("[www.google.com](https://www.google.com)")).toBe("https://www.google.com");
    expect(pastedLink("mailto:me@example.com")).toBe("mailto:me@example.com");
  });
  it("ignores ordinary text", () => {
    for (const t of ["search engine", "e.g.", "google.com", "https://a.com and more", "www.", "file.txt", ""]) {
      expect(pastedLink(t)).toBeNull();
    }
  });
  it("makes the link", () => {
    expect(linkMarkdown("search engine", "https://www.google.com")).toBe("[search engine](https://www.google.com)");
    expect(linkMarkdown("a [b]", "https://x.com/(y)")).toBe("[a \\[b\\]](https://x.com/(y%29)");
  });
});

describe("copying and pasting lines", async () => {
  const { outlineToHtml, outlineToText, parsePastedText } = await import("../src/model/clipboard.js");

  it("copies lines as an indented Markdown list and as HTML", () => {
    const roots = sketch("Porridge\n  oats\n  milk\n    or water\nSalt");
    expect(outlineToText(roots)).toBe("- Porridge\n  - oats\n  - milk\n    - or water\n- Salt\n");
    expect(outlineToHtml(roots, (t) => `<b>${t}</b>`)).toBe(
      "<ul><li><b>Porridge</b><ul><li><b>oats</b></li><li><b>milk</b><ul><li><b>or water</b></li></ul></li></ul></li><li><b>Salt</b></li></ul>",
    );
  });

  it("reads indentation and list markers from pasted text", () => {
    expect(parsePastedText("- Porridge\n  - oats\n  - milk\n    - or water\n- Salt\n")).toEqual([
      { text: "Porridge", depth: 0 },
      { text: "oats", depth: 1 },
      { text: "milk", depth: 1 },
      { text: "or water", depth: 2 },
      { text: "Salt", depth: 0 },
    ]);
    expect(parsePastedText("one\r\n\r\ntwo\n\tthree\n• four")).toEqual([
      { text: "one", depth: 0 },
      { text: "two", depth: 0 },
      { text: "three", depth: 1 },
      { text: "four", depth: 0 },
    ]);
    // Numbers stay: they're often part of the text.
    expect(parsePastedText("1. first\n2. second")[0]!.text).toBe("1. first");
  });

  it("pastes a nested list back as lines, keeping the nesting", () => {
    const { roots, tree, id } = setup("startEND\nafter");
    const lines = parsePastedText("- Porridge\n  - oats\n  - milk\n- Salt");
    const focus = pasteOutline(tree, id("startEND"), 5, 5, lines)!;
    expect(draw(roots)).toBe("startPorridge\n  oats\n  milk\nSaltEND\nafter\n");
    expect(focus).toEqual({ id: find(roots, "SaltEND").id, caret: 4 });
  });

  it("puts the rest of the line after the last pasted line, even a nested one", () => {
    const { roots, tree, id } = setup("startEND");
    pasteOutline(tree, id("startEND"), 5, 5, parsePastedText("Porridge\n  oats"));
    expect(draw(roots)).toBe("startPorridge\n  oatsEND\n");
  });
});
