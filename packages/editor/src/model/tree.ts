// The editor's in-memory form of an OPML file. Unlike core's Outline, a node
// has a stable id (for rendering and focus) and its text as a plain field.
// Converting back to OPML keeps every attribute in its original order.

import {
  headValue,
  parseOpml,
  PORRIDGE_NS,
  serializeOpml,
  type Outline,
  type XmlElement,
} from "@porridge/core";

export interface ENode {
  id: string;
  text: string;
  /** All attributes in document order. `text` here is stale; use `node.text`. */
  attrs: Record<string, string>;
  children: ENode[];
}

export interface EFile {
  path: string;
  rootAttrs: Record<string, string>;
  head: XmlElement[];
  nodes: ENode[];
}

let seq = 0;
export const newId = (): string => `n${(++seq).toString(36)}`;

export function newNode(text = "", attrs: Record<string, string> = {}): ENode {
  return { id: newId(), text, attrs: { text, ...attrs }, children: [] };
}

export function newFile(path: string, title: string): EFile {
  return {
    path,
    rootAttrs: { version: "2.0", "xmlns:porridge": PORRIDGE_NS },
    head: [{ name: "title", attrs: new Map(), text: title, children: [] }],
    nodes: [],
  };
}

export function fileFromOpml(path: string, source: string): EFile {
  const doc = parseOpml(source);
  return {
    path,
    rootAttrs: Object.fromEntries(doc.rootAttrs),
    head: doc.head,
    nodes: doc.body.map(fromOutline),
  };
}

function fromOutline(o: Outline): ENode {
  const attrs = Object.fromEntries(o.attrs);
  return { id: newId(), text: attrs.text ?? "", attrs, children: o.children.map(fromOutline) };
}

export function fileToOpml(file: EFile): string {
  return serializeOpml({
    rootAttrs: new Map(Object.entries(file.rootAttrs)),
    head: file.head,
    body: file.nodes.map(toOutline),
  });
}

function toOutline(n: ENode): Outline {
  const entries = Object.entries(n.attrs).map(([k, v]): [string, string] => [k, k === "text" ? n.text : v]);
  if (!("text" in n.attrs) && n.text !== "") entries.unshift(["text", n.text]);
  return { attrs: new Map(entries), children: n.children.map(toOutline) };
}

export function fileHead(file: EFile, name: string): string | undefined {
  return headValue({ rootAttrs: new Map(Object.entries(file.rootAttrs)), head: file.head, body: [] }, name);
}

// ---------------------------------------------------------------------------
// Node kinds

export type Kind = "month" | "day" | "include" | "node";

export function kind(n: ENode): Kind {
  switch (n.attrs.type) {
    case "calendarMonth":
      return "month";
    case "calendarDay":
      return "day";
    case "include":
      return "include";
    default:
      return "node";
  }
}

/** Structural nodes the editor maintains: their text and position aren't edited by hand. */
export const isLocked = (n: ENode): boolean => kind(n) !== "node";

export const isYearFile = (path: string): boolean => /^blog\/\d{4}\.opml$/.test(path);

/** Key that identifies a node across reloads (used to remember collapse state). */
export function stableKey(n: ENode): string | undefined {
  if (n.attrs.date) return `d:${n.attrs.date}`;
  if (n.attrs.created) return `c:${n.attrs.created}`;
  return undefined;
}

export function* walk(nodes: ENode[]): Generator<ENode> {
  for (const n of nodes) {
    yield n;
    yield* walk(n.children);
  }
}

// ---------------------------------------------------------------------------
// Head settings

/**
 * The element name to write for a head setting: `porridge:x` uses whichever
 * prefix the file binds to the Porridge namespace (declaring it if needed).
 */
export function headName(file: EFile, name: string): string {
  if (!name.startsWith("porridge:")) return name;
  const local = name.slice("porridge:".length);
  let prefix = Object.entries(file.rootAttrs).find(([k, v]) => k.startsWith("xmlns:") && v === PORRIDGE_NS)?.[0].slice(6);
  if (!prefix) {
    prefix = file.rootAttrs["xmlns:porridge"] === undefined ? "porridge" : "porridgens";
    file.rootAttrs[`xmlns:${prefix}`] = PORRIDGE_NS;
  }
  return `${prefix}:${local}`;
}

/**
 * Set a head element (`title`, or a Porridge setting like `porridge:inNav`).
 * An empty value removes it. Declares the Porridge namespace if needed.
 */
export function setHead(file: EFile, name: string, value: string) {
  const qname = headName(file, name);
  const i = file.head.findIndex((e) => e.name === qname);
  if (value === "") {
    if (i >= 0) file.head.splice(i, 1);
  } else if (i >= 0) {
    file.head[i]!.text = value;
  } else {
    file.head.push({ name: qname, attrs: new Map(), text: value, children: [] });
  }
}

/** "My Book Notes!" → "my-book-notes" */
export function slugify(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(s) ? s : `page-${s}`.replace(/-$/, "");
}

export const pagePath = (slug: string): string => `pages/${slug}.opml`;
export const pageSlug = (path: string): string => path.slice("pages/".length, -".opml".length);
