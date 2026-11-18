// Actions on the line being edited, shared by keyboard shortcuts, the phone
// toolbar and the line menu.

import { indent, locate, move, outdent } from "../model/ops.js";
import type { ENode } from "../model/tree.js";
import type { Workspace } from "./workspace.svelte.js";

export interface Editing {
  node: ENode;
  ta: HTMLTextAreaElement;
}

/** The line being edited and its textarea, if any. */
export function editing(ws: Workspace): Editing | null {
  const id = ws.editingId;
  const node = id && ws.file ? locate(ws.file.nodes, id)?.node : undefined;
  const ta = id ? (document.getElementById(`ta-${id}`) as HTMLTextAreaElement | null) : null;
  return node && ta ? { node, ta } : null;
}

export const doIndent = (ws: Workspace, { node, ta }: Editing) =>
  ws.op("indent", node.id, (t) => indent(t, node.id), ta.selectionStart);

export const doOutdent = (ws: Workspace, { node, ta }: Editing) =>
  ws.op("outdent", node.id, (t) => outdent(t, node.id), ta.selectionStart);

export const doMove = (ws: Workspace, { node, ta }: Editing, dir: -1 | 1) =>
  ws.op("move", node.id, (t) => move(t, node.id, dir), ta.selectionStart);

export interface Range {
  start: number;
  end: number;
}

/** The selection in a textarea, if there is one. */
export const rangeOf = (ta: HTMLTextAreaElement | null): Range | null =>
  ta ? { start: ta.selectionStart, end: ta.selectionEnd } : null;

/** Ask for a link or image to put at `range` (or after the text, when there's no cursor). */
export function startInsert(ws: Workspace, kind: "link" | "image", node: ENode, range: Range | null, file?: File) {
  const { start, end } = range ?? { start: node.text.length, end: node.text.length };
  ws.inserting = { kind, id: node.id, start, end, selected: node.text.slice(start, end), file };
}

/**
 * If pasted text is a single web address (or a Markdown link), the address to
 * link selected text to. `www.` addresses get https:// so they aren't treated
 * as pages on the blog itself.
 */
export function pastedLink(text: string): string | null {
  const t = text.trim();
  const md = /^\[[^\]]*\]\(([^)\s]+)\)$/.exec(t);
  const url = md ? md[1]! : t;
  if (/\s/.test(url)) return null;
  if (/^(https?:\/\/|mailto:)\S+$/i.test(url)) return url;
  if (/^www\.[^.\s]+\.\S+$/i.test(url)) return `https://${url}`;
  return null;
}

/** `[selected](url)`, keeping square brackets in the text from ending the link early. */
export const linkMarkdown = (selected: string, url: string): string =>
  `[${selected.replace(/([[\]])/g, "\\$1")}](${url.replace(/\)/g, "%29")})`;

/** An image on the clipboard (a screenshot, or an image copied from a page). */
export function pastedImage(e: ClipboardEvent): File | null {
  for (const item of Array.from(e.clipboardData?.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

/** Pasting an image opens the Add image dialog for it. Returns true if it did. */
export function pasteAsImage(e: ClipboardEvent, ws: Workspace, node: ENode, ta: HTMLTextAreaElement): boolean {
  const file = pastedImage(e);
  if (!file) return false;
  e.preventDefault();
  startInsert(ws, "image", node, rangeOf(ta), file);
  return true;
}

/**
 * Pasting a web address over selected text links the text to it. Returns true
 * if it did (one undo step, cursor after the link).
 */
export function pasteAsLink(e: ClipboardEvent, ws: Workspace, node: ENode, ta: HTMLTextAreaElement, text: string): boolean {
  const { selectionStart: start, selectionEnd: end } = ta;
  const selected = ta.value.slice(start, end);
  const url = start !== end && selected.trim() ? pastedLink(text) : null;
  if (!url) return false;
  e.preventDefault();
  ws.insertInto(node.id, start, end, linkMarkdown(selected, url));
  return true;
}

/** Markdown for a link or image, with a space before it if it follows other text. */
export function snippet(before: string, markdown: string): string {
  return before && !/\s$/.test(before) ? ` ${markdown}` : markdown;
}
