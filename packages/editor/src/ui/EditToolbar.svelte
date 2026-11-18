<script lang="ts">
  import { indentBlock, moveBlock, outdentBlock, removeBlock } from "../model/ops.js";
  import { doIndent, doMove, doOutdent, editing, rangeOf, startInsert, type Editing } from "../store/commands.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let { ws }: { ws: Workspace } = $props();

  // Sit on top of the on-screen keyboard. Android Chrome resizes the page for
  // the keyboard (see the viewport meta tag); iOS Safari doesn't, so follow
  // the visual viewport instead.
  let bottom = $state(0);
  $effect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => (bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  });

  /** Run an action on the line being edited. */
  const act = (fn: (e: Editing) => void) => () => {
    const e = editing(ws);
    if (e) fn(e);
  };

  const count = $derived(ws.block ? ws.block.end - ws.block.start + 1 : 0);

  // Tapping a button mustn't take focus from the text, or the keyboard closes.
  const keepFocus = (e: Event) => e.preventDefault();
</script>

{#if ws.selection}
<div class="edit-toolbar" role="toolbar" aria-label="Selected lines" style="bottom:{bottom}px">
  <span class="tb-count">{count} selected</span>
  <button aria-label="Outdent" onclick={() => ws.blockOp("outdent", (t, b) => outdentBlock(t, b))}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M17 5H9M17 10H9M17 15H9M6 7l-3 3 3 3" /></svg>
  </button>
  <button aria-label="Indent" onclick={() => ws.blockOp("indent", (t, b) => indentBlock(t, b))}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M17 5H9M17 10H9M17 15H9M3 7l3 3-3 3" /></svg>
  </button>
  <button aria-label="Move up" onclick={() => ws.blockOp("move", (_t, b) => moveBlock(b, -1))}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4M5 9l5-5 5 5" /></svg>
  </button>
  <button aria-label="Move down" onclick={() => ws.blockOp("move", (_t, b) => moveBlock(b, 1))}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M5 11l5 5 5-5" /></svg>
  </button>
  <button aria-label="Undo" onclick={() => ws.undo()}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4L3 8l4 4M3 8h9a5 5 0 0 1 0 10H9" /></svg>
  </button>
  <button
    aria-label="Delete"
    class="tb-danger"
    onclick={() => {
      ws.blockOp("delete", (_t, b) => removeBlock(b));
      ws.clearSelection();
    }}
  >
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11" /></svg>
  </button>
  <span class="tb-spacer"></span>
  <button class="tb-text" onclick={() => ws.clearSelection()}>Done</button>
</div>
{:else}
<div class="edit-toolbar" role="toolbar" aria-label="Editing" style="bottom:{bottom}px">
  <button aria-label="Outdent" onmousedown={keepFocus} onclick={act((e) => doOutdent(ws, e))}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M17 5H9M17 10H9M17 15H9M6 7l-3 3 3 3" /></svg>
  </button>
  <button aria-label="Indent" onmousedown={keepFocus} onclick={act((e) => doIndent(ws, e))}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M17 5H9M17 10H9M17 15H9M3 7l3 3-3 3" /></svg>
  </button>
  <button aria-label="Move up" onmousedown={keepFocus} onclick={act((e) => doMove(ws, e, -1))}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4M5 9l5-5 5 5" /></svg>
  </button>
  <button aria-label="Move down" onmousedown={keepFocus} onclick={act((e) => doMove(ws, e, 1))}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M5 11l5 5 5-5" /></svg>
  </button>
  <span class="tb-sep"></span>
  <button aria-label="Undo" onmousedown={keepFocus} onclick={() => ws.undo()}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4L3 8l4 4M3 8h9a5 5 0 0 1 0 10H9" /></svg>
  </button>
  <span class="tb-sep"></span>
  <button aria-label="Add link" onmousedown={keepFocus} onclick={act(({ node, ta }) => startInsert(ws, "link", node, rangeOf(ta)))}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 12l4-4M7 9l-2 2a3 3 0 0 0 4 4l2-2M13 11l2-2a3 3 0 0 0-4-4L9 7" /></svg>
  </button>
  <button aria-label="Add image" onmousedown={keepFocus} onclick={act(({ node, ta }) => ws.pickImage?.(node, rangeOf(ta)))}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2" /><circle cx="8" cy="8.5" r="1.5" /><path d="M17 13l-4-4-7 7" /></svg>
  </button>
  <button
    aria-label="Line menu"
    onmousedown={keepFocus}
    onclick={act(({ node }) => (ws.menu = { id: node.id, x: 0, y: 0 }))}
  >
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="16" cy="10" r="1.4" /></svg>
  </button>
  <span class="tb-spacer"></span>
  <button
    aria-label="Done"
    title="Done (hide the keyboard)"
    onmousedown={keepFocus}
    onclick={() => {
      const e = editing(ws);
      ws.editingId = null;
      e?.ta.blur();
    }}
  >
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="9" rx="1.5" /><path d="M5.5 6.5h1M9.5 6.5h1M13.5 6.5h1M6.5 9.5h7M7 15l3 2.5 3-2.5" /></svg>
  </button>
</div>
{/if}
