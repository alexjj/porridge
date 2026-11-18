<script lang="ts">
  import { locate } from "../model/ops.js";
  import { isLocked, kind, walk, type ENode } from "../model/tree.js";
  import { rangeOf, startInsert } from "../store/commands.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let { ws, sheet }: { ws: Workspace; sheet: boolean } = $props();

  const menu = $derived(ws.menu!);
  const node = $derived(ws.file ? locate(ws.file.nodes, menu.id)?.node : undefined);
  const locked = $derived(node ? isLocked(node) : true);
  const link = $derived(node ? ws.permalink(node.id) : null);
  const isDraft = $derived(node?.attrs.isDraft === "true");
  const isComment = $derived(node?.attrs.isComment === "true");
  const collapsed = $derived(node ? ws.collapsed.has(node.id) : false);

  let el: HTMLDivElement | undefined = $state();

  // Keep a popup menu on screen.
  const style = $derived.by(() => {
    if (sheet) return "";
    const x = Math.min(menu.x, window.innerWidth - 240);
    const y = Math.min(menu.y, window.innerHeight - 360);
    return `left:${Math.max(8, x)}px;top:${Math.max(56, y)}px`;
  });

  $effect(() => {
    el?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus({ preventScroll: true });
  });

  function close() {
    ws.menu = null;
  }

  /** Close the menu, then act on its line (captured first: closing clears it). */
  function run(fn: (n: ENode) => void) {
    return () => {
      const n = node;
      close();
      if (n) fn(n);
    };
  }

  // If the line is being edited, remember the cursor now: opening the menu
  // takes focus away from the text.
  // svelte-ignore state_referenced_locally
  const cursor = rangeOf(document.getElementById(`ta-${menu.id}`) as HTMLTextAreaElement | null);

  async function copy(url: string | null) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      ws.notify("Link copied");
    } catch {
      prompt("Copy this link:", url);
    }
  }

  function remove(node: ENode) {
    const locked = isLocked(node);
    const count = [...walk(node.children)].length;
    const what = kind(node) === "day" || kind(node) === "month" ? node.text : `"${node.text.slice(0, 40) || "this line"}"`;
    if ((count > 0 || locked) && !confirm(`Delete ${what}${count ? ` and the ${count} line${count === 1 ? "" : "s"} inside it` : ""}?`)) return;
    ws.removeNode(node.id);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(el?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }
</script>

{#if node}
  <button class="menu-scrim" class:sheet aria-label="Close menu" tabindex="-1" onclick={close}></button>
  <div bind:this={el} class="node-menu" class:sheet role="menu" aria-label="Line menu" {style} tabindex="-1" {onkeydown}>
    {#if sheet}<div class="sheet-title">{node.text || "Empty line"}</div>{/if}
    <button role="menuitem" onclick={run((n) => ws.zoomTo(n.id))}>Zoom in</button>
    {#if !locked}
      <button role="menuitem" onclick={run((n) => ws.select(n.id, n.id, true))}>Select…</button>
    {/if}
    {#if !locked}
      <button role="menuitem" onclick={run((n) => startInsert(ws, "link", n, cursor))}>Add link…</button>
      <button role="menuitem" onclick={run((n) => ws.pickImage?.(n, cursor))}>Add image…</button>
    {/if}
    {#if link}
      <button role="menuitem" onclick={run((n) => copy(ws.permalink(n.id)))}>Copy link</button>
    {/if}
    {#if !locked}
      <hr />
      <button role="menuitemcheckbox" aria-checked={isDraft} onclick={run((n) => ws.setFlag(n.id, "isDraft", n.attrs.isDraft !== "true"))}>
        {isDraft ? "Not a draft" : "Draft (don't publish)"}
      </button>
      <button role="menuitemcheckbox" aria-checked={isComment} onclick={run((n) => ws.setFlag(n.id, "isComment", n.attrs.isComment !== "true"))}>
        {isComment ? "Not a comment" : "Comment (note to self)"}
      </button>
    {/if}
    {#if node.children.length}
      <button role="menuitem" onclick={run((n) => ws.toggle(n.id))}>{collapsed ? "Expand" : "Collapse"}</button>
    {/if}
    <hr />
    <button role="menuitem" class="danger" onclick={run(remove)}>Delete</button>
  </div>
{/if}
