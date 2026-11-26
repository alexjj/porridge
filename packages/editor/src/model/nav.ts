// The site's navigation as Blog settings shows it: pages that are in the
// navigation, outside links, and the archive, in the order the site shows
// them (the same rules as the builder's).
import { headElements, navUrlProblem } from "@porridge/core";
import { fileHead, headName, pageSlug, setHead, type EFile } from "./tree.js";

export type NavEntry =
  | { kind: "page"; path: string; label: string; order: number }
  | { kind: "link"; label: string; url: string; order: number }
  | { kind: "archive"; label: string; order: number };

const asDoc = (file: EFile) => ({ rootAttrs: new Map(Object.entries(file.rootAttrs)), head: file.head, body: [] });

function num(raw: string | undefined, fallback: number): number {
  return raw && Number.isFinite(Number(raw)) ? Number(raw) : fallback;
}

export function readNav(files: Record<string, EFile>): NavEntry[] {
  const blog = files["blog.opml"];
  const items: NavEntry[] = [];
  for (const [path, file] of Object.entries(files)) {
    if (!path.startsWith("pages/") || fileHead(file, "porridge:inNav") !== "true") continue;
    const label = fileHead(file, "porridge:navLabel") || fileHead(file, "title") || pageSlug(path);
    items.push({ kind: "page", path, label, order: num(fileHead(file, "porridge:navOrder"), 100) });
  }
  if (blog) {
    for (const el of headElements(asDoc(blog), "porridge:navLink")) {
      items.push({ kind: "link", label: el.text, url: el.attrs.get("url") ?? "", order: num(el.attrs.get("navOrder"), 100) });
    }
  }
  // Stable sort: links keep their file order among equals, as in the builder.
  items.sort((a, b) => a.order - b.order || a.label.trim().localeCompare(b.label.trim()));
  const archive = num(blog && fileHead(blog, "porridge:archiveNavOrder"), Infinity);
  const at = items.findIndex((i) => i.order > archive);
  items.splice(at < 0 ? items.length : at, 0, { kind: "archive", label: "Archive", order: archive });
  return items;
}

/**
 * Write the navigation in this order: numbers every entry 10, 20, 30… (pages
 * in their own files, links and the archive in blog.opml). Returns the paths
 * changed.
 */
export function writeNav(files: Record<string, EFile>, entries: NavEntry[]): string[] {
  const blog = files["blog.opml"];
  if (!blog) return [];
  const changed = new Set<string>(["blog.opml"]);
  const links: { label: string; url: string; order: number }[] = [];
  entries.forEach((e, i) => {
    const order = (i + 1) * 10;
    if (e.kind === "page") {
      const file = files[e.path];
      if (file && fileHead(file, "porridge:navOrder") !== String(order)) {
        setHead(file, "porridge:navOrder", String(order));
        changed.add(e.path);
      }
    } else if (e.kind === "link") {
      links.push({ label: e.label, url: e.url, order });
    } else {
      // Last is where the archive goes anyway: no setting needed.
      setHead(blog, "porridge:archiveNavOrder", i === entries.length - 1 ? "" : String(order));
    }
  });
  setNavLinks(blog, links);
  return [...changed];
}

/** Replace the navLink elements, where the first one was (or at the end). */
export function setNavLinks(blog: EFile, links: { label: string; url: string; order: number }[]) {
  const name = headName(blog, "porridge:navLink");
  const first = blog.head.findIndex((e) => e.name === name);
  const kept = blog.head.filter((e) => e.name !== name);
  const els = links.map((l) => ({
    name,
    attrs: new Map([
      ["url", l.url],
      ["navOrder", String(l.order)],
    ]),
    text: l.label,
    children: [],
  }));
  kept.splice(first < 0 ? kept.length : first, 0, ...els);
  blog.head = kept;
}

/** A problem with a link to show beside it, or "". */
export function linkProblem(label: string, url: string): string {
  if (!label.trim()) return "Give it a label.";
  return navUrlProblem(url.trim()) ? `Not a web address: start it with https:// (or / for a page on this site).` : "";
}
