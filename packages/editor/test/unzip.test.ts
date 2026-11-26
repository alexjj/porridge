import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listZip, readZipEntry } from "../src/store/unzip.js";
import { zip } from "../src/store/zip.js";

const bar = new Blob([readFileSync(join(import.meta.dirname, "fixtures/sample.bar"))]);

describe("reading a ZIP", () => {
  it("lists the files and reads deflated and stored ones", async () => {
    const entries = await listZip(bar);
    expect([...entries.keys()].sort()).toEqual(["feed.json", "index.html", "uploads/2025/hill-m.png", "uploads/2025/hill.png"]);
    const feed = JSON.parse(await (await readZipEntry(bar, entries.get("feed.json")!)).text());
    expect(feed.items).toHaveLength(2);
    expect(entries.get("feed.json")!.method).toBe(8);
    const png = await readZipEntry(bar, entries.get("uploads/2025/hill.png")!, "image/png");
    expect(png.type).toBe("image/png");
    expect([...new Uint8Array(await png.slice(0, 4).arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("reads the editor's own ZIPs", async () => {
    const z = zip([{ path: "blog.opml", data: "<opml/>" }, { path: "images/a.bin", data: new Uint8Array([1, 2, 3]) }]);
    const entries = await listZip(z);
    expect(await (await readZipEntry(z, entries.get("blog.opml")!)).text()).toBe("<opml/>");
  });

  it("refuses files that aren't ZIPs", async () => {
    await expect(listZip(new Blob(["just text"]))).rejects.toThrow("This file isn't a ZIP archive.");
  });
});
