<script lang="ts">
  import NodeView from "./NodeView.svelte";
  import { isLocked, kind, type ENode } from "../model/tree.js";
  import { pasteLines } from "../model/ops.js";
  import { handleKey } from "../store/keys.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let { node, ws }: { node: ENode; ws: Workspace } = $props();

  const locked = $derived(isLocked(node));
  const hasKids = $derived(node.children.length > 0);
  const isCollapsed = $derived(ws.collapsed.has(node.id));
  const editing = $derived(ws.editingId === node.id);
  const nodeKind = $derived(kind(node));
  const isDraft = $derived(node.attrs.isDraft === "true");
  const isComment = $derived(node.attrs.isComment === "true");
  const selected = $derived(ws.selectedIds.has(node.id));

  // Selecting several lines: drag across them with the mouse, or shift-click.
  function onRowPointerDown(e: PointerEvent) {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".bullet, .toggle")) return;
    if (e.shiftKey) {
      const from = ws.selection?.anchor ?? ws.editingId;
      if (from && from !== node.id && ws.select(from, node.id)) {
        e.preventDefault();
        return;
      }
    }
    if (ws.selection && !ws.selection.sticky) ws.clearSelection();
    ws.dragAnchor = node.id;
  }

  function onRowPointerEnter(e: PointerEvent) {
    const anchor = ws.dragAnchor;
    if (!anchor || !(e.buttons & 1)) return;
    if (anchor !== node.id || ws.selection) ws.select(anchor, node.id);
  }

  /** On touch screens, after "Select" in the line menu, taps extend the selection. */
  function extendBySticky(): boolean {
    const s = ws.selection;
    if (!s?.sticky) return false;
    ws.select(s.anchor, node.id);
    return true;
  }

  let ta: HTMLTextAreaElement | undefined = $state();

  function autosize() {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }

  $effect(() => {
    void node.text;
    if (editing) autosize();
  });

  function startEditing(e: MouseEvent) {
    if (extendBySticky()) return;
    // Shift-click selected lines (on pointerdown); don't start editing.
    if (e.shiftKey && ws.selection) return;
    const link = (e.target as HTMLElement).closest("a");
    if (link) {
      e.preventDefault();
      window.open(link.href, "_blank", "noopener");
      return;
    }
    ws.focusNode(node.id, node.text.length);
  }

  function onPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text.includes("\n") || !ta) return;
    e.preventDefault();
    const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l, i, all) => l || (i > 0 && i < all.length - 1));
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (lines.length < 2) {
      ws.setText(node, ta.value.slice(0, start) + (lines[0] ?? "") + ta.value.slice(end));
      return;
    }
    ws.op("paste", node.id, (t) => pasteLines(t, node.id, start, end, lines));
  }

  // Moving a node rebuilds its textarea, and removing the old one fires blur.
  // Only stop editing if focus really went somewhere else.
  function onBlur() {
    const id = node.id;
    setTimeout(() => {
      if (ws.editingId === id && document.activeElement?.id !== `ta-${id}`) ws.editingId = null;
    });
  }
</script>

<li class="node {nodeKind}" class:draft={isDraft} class:comment={isComment} class:selected data-id={node.id}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="row" onpointerdown={onRowPointerDown} onpointerenter={onRowPointerEnter}>
    {#if hasKids}
      <button
        class="toggle"
        class:closed={isCollapsed}
        aria-label={isCollapsed ? "Expand" : "Collapse"}
        aria-expanded={!isCollapsed}
        tabindex="-1"
        onclick={() => ws.toggle(node.id)}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l4 3-4 3z" /></svg>
      </button>
    {/if}
    <button
      class="bullet"
      class:has-hidden={hasKids && isCollapsed}
      aria-label="Line menu"
      aria-haspopup="menu"
      tabindex="-1"
      onclick={(e) => {
        if (extendBySticky()) return;
        const r = e.currentTarget.getBoundingClientRect();
        ws.menu = { id: node.id, x: r.left, y: r.bottom + 4 };
      }}
    ></button>

    {#if locked}
      <div class="label">{node.text}</div>
    {:else if editing}
      <textarea
        bind:this={ta}
        id="ta-{node.id}"
        class="text editing"
        rows="1"
        spellcheck="true"
        value={node.text}
        oninput={(e) => {
          ws.setText(node, e.currentTarget.value);
          autosize();
        }}
        onkeydown={(e) => ta && handleKey(e, ws, node, ta)}
        onpaste={onPaste}
        onblur={onBlur}
      ></textarea>
    {:else}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="text rendered"
        class:empty={node.text === ""}
        role="textbox"
        tabindex="0"
        onmousedown={(e) => e.preventDefault()}
        onclick={startEditing}
        onfocus={() => ws.focusNode(node.id, node.text.length)}
        onkeydown={() => {}}
      >
        {@html ws.renderText(node.text)}
      </div>
    {/if}
    {#if isDraft}<span class="tag">Draft</span>{/if}
  </div>

  {#if hasKids && !isCollapsed}
    <ul class="children">
      {#each node.children as child (child.id)}
        <NodeView node={child} {ws} />
      {/each}
    </ul>
  {/if}
</li>
