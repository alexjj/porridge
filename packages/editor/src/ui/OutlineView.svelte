<script lang="ts">
  import NodeView from "./NodeView.svelte";
  import { ancestors } from "../model/ops.js";
  import { isLocked, isYearFile, kind } from "../model/tree.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let { ws, onpagesettings }: { ws: Workspace; onpagesettings: (path: string) => void } = $props();

  const file = $derived(ws.file);
  const zoom = $derived(ws.zoom);
  const scope = $derived(zoom ? zoom.children : (file?.nodes ?? []));
  const crumbs = $derived(file && zoom ? ancestors(file.nodes, zoom.id) : []);
  const isYear = $derived(file ? isYearFile(file.path) : false);
  // Entries can be added inside a day, or anywhere in a page.
  const canAdd = $derived(zoom ? !isLocked(zoom) || kind(zoom) === "day" : !isYear);
</script>

{#if file}
  <div class="outline">
    <nav class="crumbs" aria-label="Zoom path">
      {#if zoom}
        <button class="crumb" onclick={() => ws.zoomTo(null)}>{ws.title(file.path)}</button>
        {#each crumbs as c (c.id)}
          <span class="sep">›</span>
          <button class="crumb" onclick={() => ws.zoomTo(c.id)}>{c.text || "…"}</button>
        {/each}
      {/if}
    </nav>
    <h1 class="doc-title">
      {#if zoom}
        {#if isLocked(zoom)}{zoom.text}{:else}{@html ws.renderText(zoom.text) || "Untitled"}{/if}
      {:else}
        {ws.title(file.path)}
        {#if file.path.startsWith("pages/")}
          <button class="icon title-action" aria-label="Page settings" title="Page settings" onclick={() => onpagesettings(file.path)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></svg>
          </button>
        {/if}
        {#if file.path.startsWith("pages/") && file.head.some((h) => h.name.endsWith(":isDraft") && h.text === "true")}
          <span class="tag">Draft</span>
        {/if}
      {/if}
    </h1>

    <ul class="nodes">
      {#each scope as node (node.id)}
        <NodeView {node} {ws} />
      {/each}
    </ul>

    {#if scope.length === 0}
      <div class="empty-state">
        {#if canAdd}
          <button class="add" onclick={() => ws.addChild(zoom)}>+ Add a line</button>
        {:else}
          <p>No posts here yet. Use <strong>New entry</strong> to write today's.</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}
