// Importing a micro.blog Blog Archive (.bar) in the browser: read feed.json
// out of the zip, convert the posts, then copy the images and videos they use
// (resized to WebP like any other photo).
import { convertMicroblog, retarget, unlinkMedia, type ImportedPost, type MediaJob, type MicroblogImport } from "@porridge/core";
import { listZip, readZipEntry, type ZipEntry } from "./unzip.js";
import { prepareImage } from "./photos.js";

export interface ArchivePlan {
  archive: Blob;
  result: MicroblogImport;
  /** Posts not imported before. */
  posts: ImportedPost[];
  /** Posts already in the blog (same micro.blog address). */
  duplicates: number;
  /** Media files the new posts use. */
  media: MediaJob[];
  /** Media the posts use that the archive doesn't have: their posts keep the micro.blog address. */
  missing: string[];
  entries: Map<string, ZipEntry>;
  /** Folder inside the zip that holds feed.json ("" at the top). */
  root: string;
}

/** Open a .bar file and work out what importing it would do. */
export async function planArchive(archive: Blob, timezone: string, alreadyImported: Set<string>): Promise<ArchivePlan> {
  const entries = await listZip(archive);
  const feedEntry = [...entries.values()]
    .filter((e) => e.name === "feed.json" || e.name.endsWith("/feed.json"))
    .sort((a, b) => a.name.length - b.name.length)[0];
  if (!feedEntry) throw new Error("There's no feed.json in this file. Is it a micro.blog Blog Archive (.bar)?");
  const root = feedEntry.name.slice(0, -"feed.json".length);
  let feed: unknown;
  try {
    feed = JSON.parse(await (await readZipEntry(archive, feedEntry)).text());
  } catch {
    throw new Error("The archive's feed.json couldn't be read.");
  }
  const result = convertMicroblog(feed, timezone);

  // Only media for posts that will be imported; anything missing keeps its old address.
  const posts = result.posts.filter((p) => !alreadyImported.has(p.url));
  const used = new Set<string>();
  const text = (l: ImportedPost["line"]): string => [l.text, ...(l.children ?? []).map(text)].join("\n");
  const all = posts.map((p) => text(p.line)).join("\n");
  const missing: string[] = [];
  for (const job of [...result.media]) {
    if (!all.includes(`/${job.target}`)) continue;
    if (!entries.has(root + job.source)) {
      missing.push(job.source);
      unlinkMedia(result, job);
    } else {
      used.add(job.source);
    }
  }
  return {
    archive,
    result,
    posts,
    duplicates: result.posts.length - posts.length,
    media: result.media.filter((m) => used.has(m.source)),
    missing,
    entries,
    root,
  };
}

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/mp4",
};

/**
 * Copy the media out of the archive: images resized (their posts follow if
 * one keeps its own format), videos as they are. Calls `progress` after each.
 */
export async function prepareMedia(
  plan: ArchivePlan,
  progress: (done: number, total: number) => void,
): Promise<{ files: { path: string; blob: Blob }[]; problems: string[] }> {
  const files: { path: string; blob: Blob }[] = [];
  const problems: string[] = [];
  const jobs = [...plan.media];
  let done = 0;
  for (const job of jobs) {
    const name = job.source.split("/").pop()!;
    const type = TYPES[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
    try {
      const blob = await readZipEntry(plan.archive, plan.entries.get(plan.root + job.source)!, type);
      if (job.kind === "video") {
        files.push({ path: job.target, blob });
      } else {
        const prepared = await prepareImage(new File([blob], name, { type }));
        let path = job.target;
        if (!path.endsWith(`.${prepared.ext}`)) {
          const to = path.replace(/\.\w+$/, `.${prepared.ext}`);
          retarget(plan.result, path, to);
          path = to;
        }
        files.push({ path, blob: prepared.blob });
      }
    } catch (err) {
      problems.push(`${job.source}: ${(err as Error).message}`);
      unlinkMedia(plan.result, job);
    }
    progress(++done, jobs.length);
  }
  return { files, problems };
}
