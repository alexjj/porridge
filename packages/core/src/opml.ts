// OPML parsing and serialisation.
//
// The model keeps everything needed to write a file back unchanged: attribute
// order, unknown attributes and namespaces, and arbitrary head elements.
// Files written by `serializeOpml` come back byte-identical through
// parse → serialize.

import { SaxesParser } from "saxes";

export const PORRIDGE_NS = "https://github.com/alexjj/porridge";

/** Attributes in document order. */
export type Attrs = Map<string, string>;

/** A generic element, used for everything in <head>. */
export interface XmlElement {
  name: string;
  attrs: Attrs;
  text: string;
  children: XmlElement[];
}

export interface Outline {
  attrs: Attrs;
  children: Outline[];
}

export interface OpmlDoc {
  /** Attributes of the <opml> element, including namespace declarations. */
  rootAttrs: Attrs;
  head: XmlElement[];
  body: Outline[];
}

export class OpmlParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
    this.name = "OpmlParseError";
  }
}

export function parseOpml(source: string): OpmlDoc {
  const parser = new SaxesParser({ position: true });
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;

  parser.on("error", (err) => {
    throw new OpmlParseError(err.message, parser.line, parser.column);
  });
  parser.on("opentag", (tag) => {
    const el: XmlElement = {
      name: tag.name,
      attrs: new Map(Object.entries(tag.attributes as Record<string, string>)),
      text: "",
      children: [],
    };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(el);
    else root = el;
    stack.push(el);
  });
  parser.on("text", (text) => {
    const top = stack[stack.length - 1];
    if (top) top.text += text;
  });
  parser.on("cdata", (text) => {
    const top = stack[stack.length - 1];
    if (top) top.text += text;
  });
  parser.on("closetag", () => {
    stack.pop();
  });

  parser.write(source).close();

  if (!root || root.name !== "opml") {
    throw new OpmlParseError("Not an OPML file: the root element must be <opml>.");
  }
  const head = root.children.find((c) => c.name === "head");
  const body = root.children.find((c) => c.name === "body");
  if (!body) throw new OpmlParseError("Not an OPML file: missing <body>.");

  return {
    rootAttrs: root.attrs,
    head: (head?.children ?? []).map(trimText),
    body: body.children.filter((c) => c.name === "outline").map(toOutline),
  };
}

function trimText(el: XmlElement): XmlElement {
  return { ...el, text: el.text.trim(), children: el.children.map(trimText) };
}

function toOutline(el: XmlElement): Outline {
  return {
    attrs: el.attrs,
    children: el.children.filter((c) => c.name === "outline").map(toOutline),
  };
}

// ---------------------------------------------------------------------------
// Serialisation

const INDENT = "  ";

export function serializeOpml(doc: OpmlDoc): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  out.push(`<opml${attrsToString(doc.rootAttrs)}>`);
  if (doc.head.length === 0) {
    out.push(`${INDENT}<head/>`);
  } else {
    out.push(`${INDENT}<head>`);
    for (const el of doc.head) writeElement(out, el, 2);
    out.push(`${INDENT}</head>`);
  }
  if (doc.body.length === 0) {
    out.push(`${INDENT}<body/>`);
  } else {
    out.push(`${INDENT}<body>`);
    for (const o of doc.body) writeOutline(out, o, 2);
    out.push(`${INDENT}</body>`);
  }
  out.push("</opml>");
  return out.join("\n") + "\n";
}

function writeElement(out: string[], el: XmlElement, depth: number) {
  const pad = INDENT.repeat(depth);
  const open = `${pad}<${el.name}${attrsToString(el.attrs)}`;
  if (el.children.length > 0) {
    out.push(`${open}>`);
    for (const c of el.children) writeElement(out, c, depth + 1);
    out.push(`${pad}</${el.name}>`);
  } else if (el.text !== "") {
    out.push(`${open}>${escapeText(el.text)}</${el.name}>`);
  } else {
    out.push(`${open}/>`);
  }
}

function writeOutline(out: string[], o: Outline, depth: number) {
  const pad = INDENT.repeat(depth);
  const open = `${pad}<outline${attrsToString(o.attrs)}`;
  if (o.children.length === 0) {
    out.push(`${open}/>`);
    return;
  }
  out.push(`${open}>`);
  for (const c of o.children) writeOutline(out, c, depth + 1);
  out.push(`${pad}</outline>`);
}

function attrsToString(attrs: Attrs): string {
  let s = "";
  for (const [k, v] of attrs) s += ` ${k}="${escapeAttr(v)}"`;
  return s;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s)
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
}

// ---------------------------------------------------------------------------
// Helpers

/** Namespace prefixes bound to `uri` on the <opml> element. */
function prefixesFor(doc: OpmlDoc, uri: string): string[] {
  const prefixes: string[] = [];
  for (const [k, v] of doc.rootAttrs) {
    if (v === uri && k.startsWith("xmlns:")) prefixes.push(k.slice(6));
  }
  return prefixes;
}

/**
 * Text of a head element. `name` is a plain OPML element (`title`), or a
 * Porridge setting given as `porridge:homeDays`, which matches whichever
 * prefix the file binds to the Porridge namespace.
 */
export function headValue(doc: OpmlDoc, name: string): string | undefined {
  let names = [name];
  if (name.startsWith("porridge:")) {
    const local = name.slice("porridge:".length);
    names = prefixesFor(doc, PORRIDGE_NS).map((p) => `${p}:${local}`);
  }
  const el = doc.head.find((e) => names.includes(e.name));
  return el?.text;
}

export function attr(o: Outline, name: string): string | undefined {
  return o.attrs.get(name);
}

export function isTrue(value: string | undefined): boolean {
  return value === "true";
}

/** Drafts and comments are kept in files but never published. */
export function isPublished(o: Outline): boolean {
  return !isTrue(o.attrs.get("isDraft")) && !isTrue(o.attrs.get("isComment"));
}

export function publishedChildren(o: Outline): Outline[] {
  return o.children.filter(isPublished);
}
