import { describe, expect, it } from "vitest";
import { importedAddresses, insertImported } from "../src/model/calendar.js";
import { fileFromOpml, fileToOpml, type EFile } from "../src/model/tree.js";

const NS = `xmlns:porridge="https://github.com/alexjj/porridge"`;
const blog = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0" ${NS}>
  <head>
    <title>T</title>
    <porridge:timezone>Europe/London</porridge:timezone>
  </head>
  <body>
    <outline text="2025" type="include" url="blog/2025.opml"/>
  </body>
</opml>
`;
const year = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0" ${NS}>
  <head>
    <title>2025</title>
  </head>
  <body>
    <outline text="September 2025" type="calendarMonth" date="2025-09">
      <outline text="12th September" type="calendarDay" date="2025-09-12">
        <outline text="Evening, written here" created="Fri, 12 Sep 2025 19:00:00 GMT"/>
        <outline text="Morning, written here" created="Fri, 12 Sep 2025 06:00:00 GMT"/>
      </outline>
    </outline>
  </body>
</opml>
`;

const files = (): Record<string, EFile> => ({
  "blog.opml": fileFromOpml("blog.opml", blog),
  "blog/2025.opml": fileFromOpml("blog/2025.opml", year),
});

const post = (date: string, created: string, text: string, url: string) => ({
  date,
  line: { text, attrs: { created, importedFrom: url }, children: [{ text: "Body" }] },
});

describe("adding imported posts", () => {
  it("puts them on their days in time order, makes new years, and skips ones already imported", () => {
    const f = files();
    const posts = [
      post("2016-01-01", "Fri, 01 Jan 2016 02:01:00 GMT", "Oldest", "https://mb/2016/a/"),
      post("2025-09-12", "Fri, 12 Sep 2025 12:00:00 GMT", "Midday, imported", "https://mb/2025/b/"),
    ];
    expect(insertImported(f, posts)).toEqual({ changed: ["blog/2016.opml", "blog.opml", "blog/2025.opml"], added: 2 });
    const day = f["blog/2025.opml"]!.nodes[0]!.children[0]!.children.map((n) => n.text);
    expect(day).toEqual(["Evening, written here", "Midday, imported", "Morning, written here"]);
    expect(f["blog.opml"]!.nodes.map((n) => n.text)).toEqual(["2025", "2016"]);
    expect(fileToOpml(f["blog/2016.opml"]!)).toContain(
      `<outline text="Oldest" created="Fri, 01 Jan 2016 02:01:00 GMT" importedFrom="https://mb/2016/a/">\n          <outline text="Body"/>`,
    );
    expect(importedAddresses(f)).toEqual(new Set(["https://mb/2016/a/", "https://mb/2025/b/"]));

    // A second import adds nothing.
    expect(insertImported(f, posts).added).toBe(0);
  });

  it("moves a post on a second when another on its day has the same time", () => {
    const f = files();
    insertImported(f, [
      post("2025-09-12", "Fri, 12 Sep 2025 06:00:00 GMT", "Same time as one written here", "https://mb/x/"),
    ]);
    const day = f["blog/2025.opml"]!.nodes[0]!.children[0]!.children;
    expect(day.map((n) => n.attrs.created)).toEqual([
      "Fri, 12 Sep 2025 19:00:00 GMT",
      "Fri, 12 Sep 2025 06:00:01 GMT",
      "Fri, 12 Sep 2025 06:00:00 GMT",
    ]);
  });
});
