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

/** Markdown for a link or image, with a space before it if it follows other text. */
export function snippet(before: string, markdown: string): string {
  return before && !/\s$/.test(before) ? ` ${markdown}` : markdown;
}
