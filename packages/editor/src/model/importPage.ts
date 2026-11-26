// Turn an OPML file from anywhere (Porridge, Drummer, Dynalist, Workflowy…)
// into the outline of a new page.
import { parseOpml, headValue, type Outline } from "@porridge/core";
import { newId, type ENode } from "./tree.js";

/** Attributes that mean something else on a page, or that are turned into text. */
const DROP = new Set(["_note", "url"]);
const CALENDAR_TYPES = new Set(["calendarMonth", "calendarDay", "include"]);

export function pageFromOpml(source: string, fileName: string): { title: string; nodes: ENode[] } {
  let doc;
  try {
    doc = parseOpml(source);
  } catch (err) {
    throw new Error(`${fileName} isn't an OPML file: ${(err as Error).message}`);
  }
  const nodes = doc.body.flatMap(convert);
  if (nodes.length === 0) throw new Error(`${fileName} has no outline in it.`);
  const title = headValue(doc, "title")?.trim() || fileName.replace(/\.(opml|xml)$/i, "");
  return { title, nodes };
}

function convert(o: Outline): ENode[] {
  const attrs = Object.fromEntries(o.attrs);
  let text = attrs.text ?? "";
  const type = attrs.type;
  // Drummer and others: a link node is its text linked to its url.
  if (type === "link" && attrs.url) {
    text = `[${text || attrs.url}](${attrs.url})`;
    delete attrs.type;
  } else if (type && CALENDAR_TYPES.has(type)) {
    delete attrs.type;
  }
  const children: ENode[] = [];
  // Dynalist and Workflowy keep a note under the line: each of its lines becomes a line under it.
  for (const line of (attrs._note ?? "").split(/\r?\n/)) {
    if (line.trim()) children.push(node(line.trim(), {}, []));
  }
  for (const c of o.children) children.push(...convert(c));
  if (!text.trim() && children.length === 0) return [];
  for (const k of DROP) delete attrs[k];
  return [node(text, attrs, children)];
}

function node(text: string, attrs: Record<string, string>, children: ENode[]): ENode {
  return { id: newId(), text, attrs: { ...attrs, text }, children };
}
