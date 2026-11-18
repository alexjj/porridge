// Outline operations. Each takes the tree being edited and returns where focus
// should go, or null when the operation doesn't apply (the caller then does
// nothing, and nothing is recorded for undo).

import { isLocked, newNode, type ENode } from "./tree.js";

export interface Tree {
  roots: ENode[];
  collapsed: Set<string>;
  /** The zoomed-in node, if any. Operations stay inside it. */
  zoom: ENode | null;
}

export interface Focus {
  id: string;
  caret: number;
}

export interface Loc {
  node: ENode;
  parent: ENode | null;
  siblings: ENode[];
  index: number;
}

export function locate(roots: ENode[], id: string, parent: ENode | null = null): Loc | null {
  for (let i = 0; i < roots.length; i++) {
    const node = roots[i]!;
    if (node.id === id) return { node, parent, siblings: roots, index: i };
    const found = locate(node.children, id, node);
    if (found) return found;
  }
  return null;
}

/** Ancestors of `id`, outermost first. */
export function ancestors(roots: ENode[], id: string): ENode[] {
  for (const node of roots) {
    if (node.id === id) return [];
    const inner = ancestors(node.children, id);
    if (inner.length || node.children.some((c) => c.id === id)) return [node, ...inner];
  }
  return [];
}

/** Nodes in display order, skipping collapsed subtrees. */
export function visible(tree: Tree): ENode[] {
  const out: ENode[] = [];
  const visit = (nodes: ENode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children.length && !tree.collapsed.has(n.id)) visit(n.children);
    }
  };
  visit(tree.zoom ? tree.zoom.children : tree.roots);
  return out;
}

/** Nearest editable node before (`-1`) or after (`1`) `id` in display order. */
export function neighbour(tree: Tree, id: string, dir: -1 | 1): ENode | undefined {
  const list = visible(tree);
  for (let i = list.findIndex((n) => n.id === id) + dir; i >= 0 && i < list.length; i += dir) {
    if (!isLocked(list[i]!)) return list[i];
  }
  return undefined;
}

function editable(tree: Tree, id: string): Loc | null {
  const loc = locate(tree.roots, id);
  return loc && !isLocked(loc.node) ? loc : null;
}

/** Enter: split the node's text at `caret`. */
export function split(tree: Tree, id: string, caret: number): Focus | null {
  const loc = editable(tree, id);
  if (!loc) return null;
  const { node, siblings, index } = loc;

  // At the start of a non-empty node, open an empty line above and stay put.
  if (caret === 0 && node.text !== "") {
    siblings.splice(index, 0, newNode());
    return { id, caret: 0 };
  }

  const after = node.text.slice(caret);
  node.text = node.text.slice(0, caret);
  const created = newNode(after);
  // A node with visible children gets the new line as its first child.
  if (node.children.length && !tree.collapsed.has(node.id)) node.children.unshift(created);
  else siblings.splice(index + 1, 0, created);
  return { id: created.id, caret: 0 };
}

/**
 * Backspace at the start: join this node onto the previous visible one. Its
 * children go with it. An empty node with no editable node above is removed.
 */
export function mergeUp(tree: Tree, id: string): Focus | null {
  const loc = editable(tree, id);
  if (!loc) return null;
  const { node, parent, siblings, index } = loc;
  const list = visible(tree);
  const prev = list[list.findIndex((n) => n.id === id) - 1];

  if (!prev || isLocked(prev)) {
    if (node.text !== "" || node.children.length) return null;
    const next = neighbour(tree, id, 1);
    siblings.splice(index, 1);
    return next ? { id: next.id, caret: 0 } : { id: "", caret: 0 };
  }

  const caret = prev.text.length;
  prev.text += node.text;
  siblings.splice(index, 1);
  if (prev === parent) {
    siblings.splice(index, 0, ...node.children);
  } else if (node.children.length) {
    prev.children.push(...node.children);
    tree.collapsed.delete(prev.id);
  }
  return { id: prev.id, caret };
}

/** Delete the node and everything under it. */
export function remove(tree: Tree, id: string): Focus | null {
  const loc = editable(tree, id);
  if (!loc) return null;
  const target = neighbour(tree, id, -1);
  const prevFocus = target && { id: target.id, caret: target.text.length };
  const nextNode = prevFocus ? undefined : nextOutside(tree, id);
  loc.siblings.splice(loc.index, 1);
  return prevFocus ?? (nextNode ? { id: nextNode.id, caret: 0 } : { id: "", caret: 0 });
}

/** The next editable node that isn't inside `id`. */
function nextOutside(tree: Tree, id: string): ENode | undefined {
  const list = visible(tree);
  const i = list.findIndex((n) => n.id === id);
  const inside = new Set<string>();
  const mark = (n: ENode) => {
    inside.add(n.id);
    n.children.forEach(mark);
  };
  mark(list[i]!);
  return list.slice(i + 1).find((n) => !inside.has(n.id) && !isLocked(n));
}

/** Tab: become the last child of the previous sibling. */
export function indent(tree: Tree, id: string): boolean {
  const loc = editable(tree, id);
  if (!loc || loc.index === 0) return false;
  const prev = loc.siblings[loc.index - 1]!;
  if (isLocked(prev)) return false;
  loc.siblings.splice(loc.index, 1);
  prev.children.push(loc.node);
  tree.collapsed.delete(prev.id);
  return true;
}

/** Shift-Tab: become the next sibling of the parent. */
export function outdent(tree: Tree, id: string): boolean {
  const loc = editable(tree, id);
  if (!loc?.parent || loc.parent === tree.zoom || isLocked(loc.parent)) return false;
  const parentLoc = locate(tree.roots, loc.parent.id)!;
  loc.siblings.splice(loc.index, 1);
  parentLoc.siblings.splice(parentLoc.index + 1, 0, loc.node);
  return true;
}

/** Swap with the previous (`-1`) or next (`1`) sibling. */
export function move(tree: Tree, id: string, dir: -1 | 1): boolean {
  const loc = editable(tree, id);
  if (!loc) return false;
  const j = loc.index + dir;
  const other = loc.siblings[j];
  if (!other || isLocked(other)) return false;
  loc.siblings[loc.index] = other;
  loc.siblings[j] = loc.node;
  return true;
}

/** Paste of several lines: the first goes in at the caret, the rest become siblings. */
export function pasteLines(tree: Tree, id: string, start: number, end: number, lines: string[]): Focus | null {
  const loc = editable(tree, id);
  if (!loc || lines.length < 2) return null;
  const { node, siblings, index } = loc;
  const tail = node.text.slice(end);
  node.text = node.text.slice(0, start) + lines[0];
  const rest = lines.slice(1).map((l) => newNode(l));
  const last = rest[rest.length - 1]!;
  const caret = last.text.length;
  last.text += tail;
  siblings.splice(index + 1, 0, ...rest);
  return { id: last.id, caret };
}

/** Enter in the zoomed-in title: text after the caret becomes its first child. */
export function splitIntoFirstChild(tree: Tree, id: string, caret: number): Focus | null {
  const loc = editable(tree, id);
  if (!loc) return null;
  const { node } = loc;
  const created = newNode(node.text.slice(caret));
  node.text = node.text.slice(0, caret);
  node.children.unshift(created);
  tree.collapsed.delete(node.id);
  return { id: created.id, caret: 0 };
}

// ---------------------------------------------------------------------------
// Selecting several lines
//
// A selection runs from an anchor line to a head line. It's widened to whole
// sibling lines under their common parent (as in Workflowy), so "indent these"
// and "move these" always act on a neat run of siblings. Calendar headings
// can't be selected.

export interface Block {
  parent: ENode | null;
  list: ENode[];
  start: number;
  end: number;
}

function chain(roots: ENode[], id: string): ENode[] {
  const loc = locate(roots, id);
  return loc ? [...ancestors(roots, id), loc.node] : [];
}

/** The run of siblings selected by anchor and head, or null if it can't be selected. */
export function block(tree: Tree, anchorId: string, headId: string): Block | null {
  const a = chain(tree.roots, anchorId);
  const h = chain(tree.roots, headId);
  if (!a.length || !h.length) return null;
  let i = 0;
  while (i < a.length && i < h.length && a[i] === h[i]) i++;

  let parent: ENode | null;
  let first: ENode;
  let last: ENode;
  if (i === a.length || i === h.length) {
    // One contains the other (or they're the same line): select the outer one.
    const outer = i === a.length ? a : h;
    first = last = outer[i - 1]!;
    parent = outer[i - 2] ?? null;
  } else {
    parent = i > 0 ? a[i - 1]! : null;
    first = a[i]!;
    last = h[i]!;
  }
  // Stay inside the zoomed-in line.
  if (tree.zoom && (first === tree.zoom || !chain(tree.roots, first.id).includes(tree.zoom))) return null;
  const list = parent ? parent.children : tree.roots;
  const ia = list.indexOf(first);
  const ih = list.indexOf(last);
  const start = Math.min(ia, ih);
  const end = Math.max(ia, ih);
  if (list.slice(start, end + 1).some(isLocked)) return null;
  return { parent, list, start, end };
}

/** Tab: the selected lines become the last children of the line above them. */
export function indentBlock(tree: Tree, b: Block): boolean {
  const prev = b.list[b.start - 1];
  if (!prev || isLocked(prev)) return false;
  const nodes = b.list.splice(b.start, b.end - b.start + 1);
  prev.children.push(...nodes);
  tree.collapsed.delete(prev.id);
  return true;
}

/** Shift-Tab: the selected lines move out to follow their parent. */
export function outdentBlock(tree: Tree, b: Block): boolean {
  const parent = b.parent;
  if (!parent || parent === tree.zoom || isLocked(parent)) return false;
  const parentLoc = locate(tree.roots, parent.id)!;
  const nodes = b.list.splice(b.start, b.end - b.start + 1);
  parentLoc.siblings.splice(parentLoc.index + 1, 0, ...nodes);
  return true;
}

/** Move the selected lines past the sibling above (-1) or below (1). */
export function moveBlock(b: Block, dir: -1 | 1): boolean {
  const i = dir === -1 ? b.start - 1 : b.end + 1;
  const other = b.list[i];
  if (!other || isLocked(other)) return false;
  b.list.splice(i, 1);
  b.list.splice(dir === -1 ? b.end : b.start, 0, other);
  return true;
}

export function removeBlock(b: Block): boolean {
  b.list.splice(b.start, b.end - b.start + 1);
  return true;
}
