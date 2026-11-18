// Keyboard shortcuts for a node being edited.

import {
  indentBlock,
  locate,
  mergeUp,
  moveBlock,
  neighbour,
  outdentBlock,
  remove,
  removeBlock,
  split,
  splitIntoFirstChild,
  visible,
} from "../model/ops.js";
import { doIndent, doMove, doOutdent, rangeOf, startInsert } from "./commands.js";
import { isLocked, type ENode } from "../model/tree.js";
import type { Workspace } from "./workspace.svelte.js";

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";

/** Shortcut list shown in the help panel. */
export const SHORTCUTS: [string, string][] = [
  ["Enter", "New line (splits at the cursor)"],
  ["Tab / Shift-Tab", "Indent / outdent"],
  [`Alt-Shift-↑ / ↓`, "Move up / down"],
  [`${MOD}-↑ / ↓`, "Collapse / expand"],
  [`${MOD}-] / [`, "Zoom in / out"],
  ["Backspace at start", "Join with the line above"],
  [`${MOD}-Shift-Backspace`, "Delete line and its children"],
  [`${MOD}-Z / ${MOD}-Shift-Z`, "Undo / redo"],
  [`${MOD}-B / ${MOD}-I`, "Bold / italic"],
  [`${MOD}-K`, "Add a link"],
  ["Esc", "Stop editing"],
];

const MIRRORED = [
  "boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "wordSpacing",
  "lineHeight", "textTransform", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "overflowWrap", "wordBreak",
] as const;

/** Vertical offset of the text position `pos`, measured with a hidden copy of the textarea. */
function offsetOf(ta: HTMLTextAreaElement, pos: number): number {
  const mirror = document.createElement("div");
  const cs = getComputedStyle(ta);
  for (const p of MIRRORED) mirror.style[p] = cs[p];
  Object.assign(mirror.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", whiteSpace: "pre-wrap", borderStyle: "solid" });
  mirror.textContent = ta.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = ta.value.slice(pos) || ".";
  mirror.append(marker);
  document.body.append(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

/** Whether the caret is on the first visual line, so ↑ should leave the textarea. */
function onFirstLine(ta: HTMLTextAreaElement): boolean {
  return ta.selectionStart === 0 || offsetOf(ta, ta.selectionStart) === offsetOf(ta, 0);
}

function onLastLine(ta: HTMLTextAreaElement): boolean {
  const end = ta.value.length;
  return ta.selectionEnd === end || offsetOf(ta, ta.selectionEnd) === offsetOf(ta, end);
}

export function handleKey(e: KeyboardEvent, ws: Workspace, node: ENode, ta: HTMLTextAreaElement) {
  if (e.isComposing) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const id = node.id;
  const stop = () => e.preventDefault();

  // Undo and redo are the editor's, not the textarea's.
  if (mod && lower === "z") {
    stop();
    if (e.shiftKey) ws.redo();
    else ws.undo();
    return;
  }
  if (mod && lower === "y") {
    stop();
    ws.redo();
    return;
  }

  // The zoomed-in line's title: Enter starts its first child, and moving,
  // indenting or joining it make no sense from inside it.
  const isTitle = ws.zoom?.id === id;
  /** Go up into the title from the first line under it. */
  const toTitle = (caret: number) => {
    const z = ws.zoom;
    if (!z || isTitle || isLocked(z)) return false;
    stop();
    ws.focusNode(z.id, Math.min(caret, z.text.length));
    return true;
  };
  if (isTitle) {
    const joinOrDelete =
      (key === "Backspace" && (mod || (start === 0 && end === 0))) ||
      (key === "Delete" && start === end && end === ta.value.length);
    if (key === "Tab" || joinOrDelete) {
      stop();
      return;
    }
  }

  if (key === "Enter") {
    stop();
    if (mod || e.altKey) return;
    if (start !== end) ws.setText(node, ta.value.slice(0, start) + ta.value.slice(end));
    if (isTitle) ws.op("split", id, (t) => splitIntoFirstChild(t, id, start));
    else ws.op("split", id, (t) => split(t, id, start));
    return;
  }

  if (key === "Tab") {
    stop();
    if (e.shiftKey) doOutdent(ws, { node, ta });
    else doIndent(ws, { node, ta });
    return;
  }

  if (key === "ArrowUp" || key === "ArrowDown") {
    const dir = key === "ArrowUp" ? -1 : 1;
    if (e.shiftKey && (e.altKey || mod)) {
      stop();
      if (!isTitle) doMove(ws, { node, ta }, dir);
      return;
    }
    if (mod) {
      stop();
      if (!isTitle) ws.setCollapsed(id, dir === -1);
      return;
    }
    // Shift-↑ at the very start or Shift-↓ at the very end selects whole lines.
    if (e.shiftKey && !e.altKey) {
      if (isTitle || (dir === -1 ? start !== 0 : end !== ta.value.length)) return;
      stop();
      ws.select(id, neighbour(ws.tree(), id, dir)?.id ?? id, false);
      return;
    }
    if (e.altKey) return;
    if (dir === -1 ? !onFirstLine(ta) : !onLastLine(ta)) return;
    const other = neighbour(ws.tree(), id, dir);
    if (other) {
      stop();
      ws.focusNode(other.id, Math.min(start, other.text.length));
    } else if (dir === -1) {
      toTitle(start);
    }
    return;
  }

  if ((key === "ArrowLeft" || key === "ArrowRight") && !mod && !e.shiftKey && !e.altKey && start === end) {
    const atEdge = key === "ArrowLeft" ? start === 0 : end === ta.value.length;
    const other = atEdge && neighbour(ws.tree(), id, key === "ArrowLeft" ? -1 : 1);
    if (other) {
      stop();
      ws.focusNode(other.id, key === "ArrowLeft" ? other.text.length : 0);
    } else if (atEdge && key === "ArrowLeft") {
      toTitle(Infinity);
    }
    return;
  }

  if (key === "Backspace" && mod && e.shiftKey) {
    stop();
    ws.op("remove", id, (t) => remove(t, id));
    return;
  }

  if (key === "Backspace" && start === 0 && end === 0 && !mod && !e.altKey) {
    stop();
    ws.op("merge", id, (t) => mergeUp(t, id));
    return;
  }

  if (key === "Delete" && start === end && end === ta.value.length && !mod) {
    const list = visible(ws.tree());
    const next = list[list.findIndex((n) => n.id === id) + 1];
    if (next && !isLocked(next)) {
      stop();
      ws.op("merge", next.id, (t) => mergeUp(t, next.id));
    }
    return;
  }

  if (mod && (key === "]" || key === "[")) {
    stop();
    if (key === "]") {
      ws.zoomTo(id);
    } else {
      const zoom = ws.zoom;
      if (zoom) ws.zoomTo(locate(ws.file!.nodes, zoom.id)?.parent?.id ?? null);
    }
    return;
  }

  if (mod && !e.shiftKey && !e.altKey && lower === "k") {
    stop();
    startInsert(ws, "link", node, rangeOf(ta));
    return;
  }

  if (mod && !e.shiftKey && !e.altKey && (lower === "b" || lower === "i")) {
    stop();
    const mark = lower === "b" ? "**" : "*";
    const v = ta.value;
    const next = v.slice(0, start) + mark + v.slice(start, end) + mark + v.slice(end);
    ta.value = next;
    ws.setText(node, next);
    ta.setSelectionRange(start + mark.length, end + mark.length);
    return;
  }

  if (key === "Escape") {
    stop();
    ws.editingId = null;
    ta.blur();
  }
}

/**
 * Keys while several lines are selected (nothing has focus then). Returns
 * true if the key was handled.
 */
export function handleSelectionKey(e: KeyboardEvent, ws: Workspace): boolean {
  const s = ws.selection;
  if (!s || e.isComposing) return false;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;

  const handled = (fn: () => void) => {
    e.preventDefault();
    fn();
    return true;
  };

  if (mod && lower === "z") return handled(() => (e.shiftKey ? ws.redo() : ws.undo()));
  if (mod && lower === "y") return handled(() => ws.redo());
  if (key === "Tab") {
    return handled(() => ws.blockOp(e.shiftKey ? "outdent" : "indent", (t, b) => (e.shiftKey ? outdentBlock(t, b) : indentBlock(t, b))));
  }
  if (key === "ArrowUp" || key === "ArrowDown") {
    const dir = key === "ArrowUp" ? -1 : 1;
    if (e.shiftKey && (e.altKey || mod)) return handled(() => ws.blockOp("move", (_t, b) => moveBlock(b, dir)));
    if (e.shiftKey) return handled(() => ws.extendSelection(dir));
    if (!mod && !e.altKey) {
      // Back to typing, on the line the selection reached.
      return handled(() => {
        const head = locate(ws.file!.nodes, s.head)?.node;
        if (head) ws.focusNode(head.id, dir === -1 ? 0 : head.text.length);
      });
    }
  }
  if (key === "Backspace" || key === "Delete") {
    return handled(() => {
      ws.blockOp("delete", (_t, b) => removeBlock(b));
      ws.clearSelection();
    });
  }
  if (key === "Enter") {
    return handled(() => {
      const head = locate(ws.file!.nodes, s.head)?.node;
      if (head) ws.focusNode(head.id, head.text.length);
    });
  }
  if (key === "Escape") return handled(() => ws.clearSelection());
  return false;
}
