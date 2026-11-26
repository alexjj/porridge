// The blog's calendar structure: year files, months, days and entries.

import {
  dayLabel,
  formatRfc822,
  isValidTimezone,
  monthLabel,
  parseRfc822,
  zonedDate,
  zonedTimeCode,
} from "@porridge/core";
import { fileHead, isYearFile, kind, newFile, newNode, type EFile, type ENode } from "./tree.js";

export function blogTimezone(files: Record<string, EFile>): string {
  const blog = files["blog.opml"];
  const tz = blog && fileHead(blog, "porridge:timezone");
  return tz && isValidTimezone(tz) ? tz : "UTC";
}

/** Insert keeping newest first by `key`; returns the node as stored in the array. */
function insertNewestFirst(list: ENode[], node: ENode, key: (n: ENode) => string): ENode {
  const k = key(node);
  const i = list.findIndex((n) => key(n) !== "" && key(n) < k);
  if (i < 0) {
    list.push(node);
    return list[list.length - 1]!;
  }
  list.splice(i, 0, node);
  return list[i]!;
}

/** A `created` value for a new entry on `day` whose anchor no other entry uses. */
export function uniqueCreated(day: ENode, now: Date, tz: string): string {
  const taken = new Set<string>();
  for (const c of day.children) {
    const d = c.attrs.created ? parseRfc822(c.attrs.created) : undefined;
    if (d) taken.add(zonedTimeCode(d, tz));
  }
  let t = Math.floor(now.getTime() / 1000) * 1000;
  while (taken.has(zonedTimeCode(new Date(t), tz))) t += 1000;
  return formatRfc822(new Date(t));
}

export interface NewEntry {
  path: string;
  id: string;
  /** Files created or changed. */
  changed: string[];
}

/**
 * The + button: make sure today's year file, include, month and day exist,
 * then add an empty entry at the top of today. An empty entry already at the
 * top is reused instead of stacking up blanks.
 */
export function addEntry(files: Record<string, EFile>, now: Date): NewEntry {
  const tz = blogTimezone(files);
  const { path, day: d, changed } = ensureDay(files, zonedDate(now, tz));
  const top = d.children[0];
  if (top && kind(top) === "node" && top.text === "" && top.children.length === 0) {
    return { path, id: top.id, changed };
  }
  d.children.unshift(newNode("", { created: uniqueCreated(d, now, tz) }));
  return { path, id: d.children[0]!.id, changed };
}

/** The day node for `date` (`YYYY-MM-DD`), making its year file, include and month if needed. */
export function ensureDay(files: Record<string, EFile>, date: string): { path: string; day: ENode; changed: string[] } {
  const blog = files["blog.opml"];
  if (!blog) throw new Error("There's no blog.opml in this workspace.");
  const year = date.slice(0, 4);
  const month = date.slice(0, 7);
  const path = `blog/${year}.opml`;
  const changed = new Set<string>([path]);

  if (!files[path]) files[path] = newFile(path, year);
  if (!blog.nodes.some((n) => kind(n) === "include" && n.attrs.url === path)) {
    insertNewestFirst(blog.nodes, newNode(year, { type: "include", url: path }), (n) =>
      kind(n) === "include" ? n.text : "",
    );
    changed.add("blog.opml");
  }

  const yf = files[path]!;
  const byDate = (k: "month" | "day") => (n: ENode) => (kind(n) === k ? (n.attrs.date ?? "") : "");
  const m =
    yf.nodes.find((n) => kind(n) === "month" && n.attrs.date === month) ??
    insertNewestFirst(yf.nodes, newNode(monthLabel(month), { type: "calendarMonth", date: month }), byDate("month"));
  const d =
    m.children.find((n) => kind(n) === "day" && n.attrs.date === date) ??
    insertNewestFirst(m.children, newNode(dayLabel(date), { type: "calendarDay", date }), byDate("day"));
  return { path, day: d, changed: [...changed] };
}

/** An imported post: the day it goes on, and its line (attrs include `created`). */
export interface ImportedEntry {
  date: string;
  line: { text: string; attrs?: Record<string, string>; children?: ImportedEntry["line"][] };
}

/** `importedFrom` addresses of every entry already in the blog. */
export function importedAddresses(files: Record<string, EFile>): Set<string> {
  const out = new Set<string>();
  for (const f of Object.values(files)) {
    if (!isYearFile(f.path)) continue;
    for (const m of f.nodes) for (const d of m.children) for (const e of d.children) if (e.attrs.importedFrom) out.add(e.attrs.importedFrom);
  }
  return out;
}

/**
 * Put imported posts on their days (newest first by `created`), skipping any
 * already imported. Returns the files changed and how many were added.
 */
export function insertImported(files: Record<string, EFile>, posts: ImportedEntry[]): { changed: string[]; added: number } {
  const seen = importedAddresses(files);
  const tz = blogTimezone(files);
  const changed = new Set<string>();
  let added = 0;
  const time = (n: ENode) => (n.attrs.created ? (parseRfc822(n.attrs.created)?.getTime() ?? 0) : 0);
  for (const post of posts) {
    const from = post.line.attrs?.importedFrom;
    if (from && seen.has(from)) continue;
    if (from) seen.add(from);
    const { path, day, changed: c } = ensureDay(files, post.date);
    c.forEach((p) => changed.add(p));
    const node = toNode(post.line);
    // Two posts at the same second would share an anchor: move this one on a second.
    const created = node.attrs.created ? parseRfc822(node.attrs.created) : undefined;
    if (created) node.attrs.created = uniqueCreated(day, created, tz);
    const t = time(node);
    const i = day.children.findIndex((n) => kind(n) === "node" && time(n) < t);
    if (i < 0) day.children.push(node);
    else day.children.splice(i, 0, node);
    changed.add(path);
    added++;
  }
  return { changed: [...changed], added };
}

function toNode(line: ImportedEntry["line"]): ENode {
  const node = newNode(line.text, line.attrs ?? {});
  node.children = (line.children ?? []).map(toNode);
  return node;
}

/**
 * Every entry (a direct child of a day) needs a unique `created`, so its anchor
 * is stable. Gives one to entries made by Enter, outdenting or pasting.
 */
export function ensureEntryTimes(file: EFile, now: Date, tz: string): boolean {
  if (!isYearFile(file.path)) return false;
  let changed = false;
  for (const m of file.nodes) {
    for (const d of m.children) {
      if (kind(d) !== "day") continue;
      for (const e of d.children) {
        if (kind(e) === "node" && !e.attrs.created) {
          e.attrs.created = uniqueCreated(d, now, tz);
          changed = true;
        }
      }
    }
  }
  return changed;
}

/** The date of the day containing `id`, if it's inside one. */
export function dayOf(file: EFile, id: string): string | undefined {
  for (const m of file.nodes) {
    for (const d of m.children) {
      if (d.id === id || contains(d, id)) return kind(d) === "day" ? d.attrs.date : undefined;
    }
  }
  return undefined;
}

function contains(n: ENode, id: string): boolean {
  return n.children.some((c) => c.id === id || contains(c, id));
}
