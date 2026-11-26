// Adding posts from a Porridge download (the "Download all" zip) to the blog
// in this browser: posts the blog doesn't have yet go on their days, with
// the photos they use. Settings, pages, posts already here and the example
// blog's posts are left alone.
import type { ImportedEntry } from "../model/calendar.js";
import { fileFromOpml, kind, type EFile, type ENode } from "../model/tree.js";
import { STARTER } from "./starter.js";
import { listZip, readZipEntry, type ZipEntry } from "./unzip.js";

export interface DownloadPlan {
  archive: Blob;
  /** Posts to add, oldest first. */
  posts: ImportedEntry[];
  /** Posts the blog already has. */
  existing: number;
  /** Posts from the example blog, left out. */
  examples: number;
  /** Photos and videos in the zip that the new posts use. */
  media: ZipEntry[];
  root: string;
}

interface Post {
  date: string;
  node: ENode;
}

function posts(files: Iterable<EFile>): Post[] {
  const out: Post[] = [];
  for (const f of files) {
    if (!/^blog\/\d{4}\.opml$/.test(f.path)) continue;
    for (const m of f.nodes) {
      if (kind(m) !== "month") continue;
      for (const d of m.children) {
        if (kind(d) !== "day" || !d.attrs.date) continue;
        for (const e of d.children) if (kind(e) === "node") out.push({ date: d.attrs.date, node: e });
      }
    }
  }
  return out;
}

/** What identifies a post: where it was imported from, or its day and time. */
const keys = (p: Post): string[] => [
  ...(p.node.attrs.importedFrom ? [`from ${p.node.attrs.importedFrom}`] : []),
  ...(p.node.attrs.created ? [`at ${p.date} ${p.node.attrs.created}`] : []),
];

const toLine = (n: ENode): ImportedEntry["line"] => {
  const { text: _stale, ...attrs } = n.attrs;
  return { text: n.text, attrs, children: n.children.map(toLine) };
};

const allText = (l: ImportedEntry["line"]): string => [l.text, ...(l.children ?? []).map(allText)].join("\n");

export async function planDownload(archive: Blob, current: Record<string, EFile>): Promise<DownloadPlan> {
  const entries = await listZip(archive);
  const yearEntries = [...entries.values()].filter((e) => /(^|\/)blog\/\d{4}\.opml$/.test(e.name));
  if (yearEntries.length === 0) throw new Error("There are no posts in this file. Is it a Porridge download (Download all)?");
  const root = yearEntries[0]!.name.replace(/blog\/\d{4}\.opml$/, "");

  const files: EFile[] = [];
  for (const e of yearEntries) {
    const path = e.name.slice(root.length);
    try {
      files.push(fileFromOpml(path, await (await readZipEntry(archive, e)).text()));
    } catch (err) {
      throw new Error(`${path} couldn't be read: ${(err as Error).message}`);
    }
  }

  const have = new Set(posts(Object.values(current)).flatMap(keys));
  const example = new Set(
    posts(Object.entries(STARTER).filter(([p]) => p.startsWith("blog/")).map(([p, t]) => fileFromOpml(p, t))).flatMap(keys),
  );

  let existing = 0;
  let examples = 0;
  const out: ImportedEntry[] = [];
  for (const p of posts(files)) {
    const k = keys(p);
    if (k.some((key) => example.has(key))) examples++;
    else if (k.some((key) => have.has(key))) existing++;
    else out.push({ date: p.date, line: toLine(p.node) });
  }
  out.sort((a, b) => Date.parse(a.line.attrs?.created ?? a.date) - Date.parse(b.line.attrs?.created ?? b.date));

  // Photos and videos the new posts use that came in the zip (others are on GitHub already).
  const used = new Set<string>();
  for (const post of out) for (const m of allText(post.line).matchAll(/\/(images\/[^\s)"'<>]+)/g)) used.add(m[1]!);
  const media = [...used].map((p) => entries.get(root + p)).filter((e): e is ZipEntry => !!e);

  return { archive, posts: out, existing, examples, media, root };
}

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
};

/** The photos and videos to add, read out of the zip. */
export async function readMedia(plan: DownloadPlan): Promise<{ path: string; blob: Blob }[]> {
  const out: { path: string; blob: Blob }[] = [];
  for (const e of plan.media) {
    const path = e.name.slice(plan.root.length);
    const type = TYPES[path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
    out.push({ path, blob: await readZipEntry(plan.archive, e, type) });
  }
  return out;
}
