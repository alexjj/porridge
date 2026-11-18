// Loads a content repo into the model the renderers use, applying the rules
// in docs/format.md: includes, calendar structure, drafts and comments,
// anchors, pages and settings.

import {
  attr,
  headValue,
  isPublished,
  isTrue,
  OpmlParseError,
  parseOpml,
  publishedChildren,
  type OpmlDoc,
  type Outline,
} from "./opml.js";
import { isValidDay, isValidMonth, isValidTimezone, parseRfc822, zonedTimeCode } from "./dates.js";

/** Where content comes from: the filesystem in the builder, GitHub in the editor. */
export interface ContentSource {
  /** File contents, or undefined if the file doesn't exist. Paths use `/`. */
  read(path: string): Promise<string | undefined>;
  /** Names of the files directly inside `dir` (not subdirectories). */
  list(dir: string): Promise<string[]>;
}

export interface Warning {
  file: string;
  message: string;
}

/** A problem that stops the build. */
export class PorridgeError extends Error {
  constructor(
    message: string,
    readonly file?: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = "PorridgeError";
  }
}

export interface Settings {
  title: string;
  description: string;
  ownerName: string;
  /** Absolute URL, always ending in `/`. */
  baseUrl: string;
  /** Path part of baseUrl, e.g. `/my-blog/`. Prefix for links within the site. */
  basePath: string;
  timezone: string;
  homeDays: number;
  rssItems: number;
  language: string;
}

export interface Entry {
  /** `YYYY-MM-DD` of the day it belongs to. */
  date: string;
  anchor: string;
  /** Markdown text of the entry's node. A title if `body` is non-null. */
  text: string;
  /** Published children, or null for an untitled single-paragraph entry. */
  body: Outline[] | null;
  created?: Date;
  node: Outline;
}

export interface Day {
  date: string;
  entries: Entry[];
}

export interface Page {
  slug: string;
  title: string;
  navLabel: string;
  inNav: boolean;
  navOrder: number;
  body: Outline[];
}

export interface Site {
  settings: Settings;
  /** Published days, newest first. */
  days: Day[];
  /** Published pages, by slug. */
  pages: Page[];
  /** Pages shown in the navigation, in order. */
  nav: Page[];
  warnings: Warning[];
}

export const RESERVED_SLUGS = ["images", "rss", "index", "assets", "archive"];
const SLUG = /^[a-z][a-z0-9-]*$/;

/** Why `slug` can't be a page name, or undefined if it can. */
export function slugProblem(slug: string): string | undefined {
  if (!SLUG.test(slug)) return "Use lowercase letters, digits and hyphens, starting with a letter.";
  if (RESERVED_SLUGS.includes(slug)) return `"${slug}" is reserved.`;
  return undefined;
}

export interface LoadOptions {
  /** Overrides porridge:baseUrl, e.g. for a local preview. */
  baseUrl?: string;
}

export async function loadSite(source: ContentSource, options: LoadOptions = {}): Promise<Site> {
  const warnings: Warning[] = [];
  const warn = (file: string, message: string) => warnings.push({ file, message });

  const blogFile = "blog.opml";
  const blog = await readOpml(source, blogFile);
  if (!blog) throw new PorridgeError("blog.opml not found.", blogFile);
  const settings = readSettings(blog, warn, options.baseUrl);

  const daysByDate = new Map<string, Day>();
  for (const node of blog.body) {
    if (attr(node, "type") !== "include") {
      warn(blogFile, `Skipped ${describe(node)}: blog.opml should only contain year includes.`);
      continue;
    }
    if (!isPublished(node)) continue;
    const url = attr(node, "url");
    if (!url) throw new PorridgeError(`Include ${describe(node)} has no url.`, blogFile);
    const path = resolvePath(blogFile, url);
    const doc = await readOpml(source, path);
    if (!doc) throw new PorridgeError(`Included file ${path} not found.`, blogFile);
    loadYear(doc, path, settings.timezone, daysByDate, warn);
  }

  const days = [...daysByDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  const pages = await loadPages(source, warn);
  const nav = pages
    .filter((p) => p.inNav)
    .sort((a, b) => a.navOrder - b.navOrder || a.navLabel.localeCompare(b.navLabel));

  return { settings, days, pages, nav, warnings };
}

async function readOpml(source: ContentSource, path: string): Promise<OpmlDoc | undefined> {
  const text = await source.read(path);
  if (text === undefined) return undefined;
  try {
    return parseOpml(text);
  } catch (err) {
    if (err instanceof OpmlParseError) {
      throw new PorridgeError(`Couldn't read ${path}: ${err.message}`, path, err.line);
    }
    throw err;
  }
}

/** Resolve `url` relative to `from`, refusing anything outside the repo. */
function resolvePath(from: string, url: string): string {
  if (/^[a-z]+:|^\//i.test(url)) {
    throw new PorridgeError(`Include url "${url}" must be a relative path.`, from);
  }
  const parts = from.split("/").slice(0, -1);
  for (const seg of url.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) throw new PorridgeError(`Include url "${url}" points outside the repo.`, from);
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

function readSettings(
  blog: OpmlDoc,
  warn: (file: string, message: string) => void,
  baseUrlOverride: string | undefined,
): Settings {
  const file = "blog.opml";
  const title = headValue(blog, "title");
  const baseUrlRaw = baseUrlOverride || headValue(blog, "porridge:baseUrl");
  const missing = [!title && "title", !baseUrlRaw && "porridge:baseUrl"].filter(Boolean);
  if (missing.length) throw new PorridgeError(`blog.opml is missing required settings: ${missing.join(", ")}.`, file);

  let url: URL;
  try {
    url = new URL(baseUrlRaw!);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    throw new PorridgeError(`porridge:baseUrl "${baseUrlRaw}" isn't an http(s) URL.`, file);
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.search = "";
  url.hash = "";

  let timezone = headValue(blog, "porridge:timezone") || "UTC";
  if (!isValidTimezone(timezone)) {
    warn(file, `Unknown timezone "${timezone}", using UTC.`);
    timezone = "UTC";
  }

  const positiveInt = (name: string, fallback: number) => {
    const raw = headValue(blog, `porridge:${name}`);
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) return n;
    warn(file, `porridge:${name} "${raw}" isn't a positive whole number, using ${fallback}.`);
    return fallback;
  };

  return {
    title: title!,
    description: headValue(blog, "description") ?? "",
    ownerName: headValue(blog, "ownerName") ?? "",
    baseUrl: url.href,
    basePath: url.pathname,
    timezone,
    homeDays: positiveInt("homeDays", 10),
    rssItems: positiveInt("rssItems", 25),
    language: headValue(blog, "porridge:language") || "en",
  };
}

function loadYear(
  doc: OpmlDoc,
  file: string,
  timezone: string,
  daysByDate: Map<string, Day>,
  warn: (file: string, message: string) => void,
) {
  for (const month of doc.body) {
    const monthDate = attr(month, "date") ?? "";
    if (attr(month, "type") !== "calendarMonth") {
      warn(file, `Skipped ${describe(month)}: expected a calendarMonth node.`);
      continue;
    }
    if (!isValidMonth(monthDate)) {
      warn(file, `Skipped month ${describe(month)}: missing or invalid date "${monthDate}".`);
      continue;
    }
    if (!isPublished(month)) continue;

    for (const dayNode of month.children) {
      const date = attr(dayNode, "date") ?? "";
      if (attr(dayNode, "type") !== "calendarDay") {
        warn(file, `Skipped ${describe(dayNode)}: expected a calendarDay node.`);
        continue;
      }
      if (!isValidDay(date) || !date.startsWith(monthDate)) {
        warn(file, `Skipped day ${describe(dayNode)}: missing or invalid date "${date}".`);
        continue;
      }
      if (!isPublished(dayNode)) continue;

      const entries = loadEntries(dayNode, date, file, timezone, warn);
      if (entries.length === 0) continue;
      const existing = daysByDate.get(date);
      if (existing) {
        warn(file, `Day ${date} appears more than once; entries were merged.`);
        existing.entries.push(...entries);
      } else {
        daysByDate.set(date, { date, entries });
      }
    }
  }
}

function loadEntries(
  dayNode: Outline,
  date: string,
  file: string,
  timezone: string,
  warn: (file: string, message: string) => void,
): Entry[] {
  // Anchors are assigned across all entries, drafts and comments included, so
  // publishing a draft never changes another entry's anchor.
  const all = dayNode.children;
  const seen = new Map<string, number>();
  const entries: Entry[] = [];

  all.forEach((node, i) => {
    const createdRaw = attr(node, "created");
    let created: Date | undefined;
    if (createdRaw !== undefined) {
      created = parseRfc822(createdRaw);
      if (!created) warn(file, `${date}: couldn't read created="${createdRaw}" on ${describe(node)}.`);
    }
    let anchor = created ? `a${zonedTimeCode(created, timezone)}` : `n${all.length - i}`;
    const count = (seen.get(anchor) ?? 0) + 1;
    seen.set(anchor, count);
    if (count > 1) {
      warn(file, `${date}: two entries share the anchor #${anchor}; ${describe(node)} gets #${anchor}-${count}.`);
      anchor = `${anchor}-${count}`;
    }

    if (!isPublished(node)) return;
    const body = node.children.length > 0 ? publishedChildren(node) : null;
    entries.push({ date, anchor, text: attr(node, "text") ?? "", body, created, node });
  });
  return entries;
}

async function loadPages(source: ContentSource, warn: (file: string, message: string) => void): Promise<Page[]> {
  const pages: Page[] = [];
  const names = (await source.list("pages")).filter((n) => n.endsWith(".opml")).sort();
  for (const name of names) {
    const file = `pages/${name}`;
    const slug = name.slice(0, -".opml".length);
    if (!SLUG.test(slug)) {
      warn(file, `Skipped page: "${slug}" isn't a valid page name (lowercase letters, digits and hyphens, starting with a letter).`);
      continue;
    }
    if (RESERVED_SLUGS.includes(slug)) {
      warn(file, `Skipped page: "${slug}" is reserved.`);
      continue;
    }
    const doc = await readOpml(source, file);
    if (!doc || isTrue(headValue(doc, "porridge:isDraft"))) continue;

    const title = headValue(doc, "title") || slug;
    const orderRaw = headValue(doc, "porridge:navOrder");
    let navOrder = 100;
    if (orderRaw) {
      if (Number.isFinite(Number(orderRaw))) navOrder = Number(orderRaw);
      else warn(file, `porridge:navOrder "${orderRaw}" isn't a number, using 100.`);
    }
    pages.push({
      slug,
      title,
      navLabel: headValue(doc, "porridge:navLabel") || title,
      inNav: isTrue(headValue(doc, "porridge:inNav")),
      navOrder,
      body: doc.body.filter(isPublished),
    });
  }
  return pages;
}

function describe(node: Outline): string {
  const text = attr(node, "text") ?? "";
  return text.length > 40 ? `"${text.slice(0, 40)}…"` : `"${text}"`;
}
