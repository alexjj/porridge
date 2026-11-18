<script lang="ts">
  import type { Workspace } from "../store/workspace.svelte.js";

  let { ws, onnavigate }: { ws: Workspace; onnavigate: () => void } = $props();

  function open(path: string) {
    ws.open(path);
    ws.zoomTo(null);
    onnavigate();
  }
</script>

<nav class="sidebar" aria-label="Files">
  <h2>Blog</h2>
  <ul>
    {#each ws.years as path (path)}
      <li>
        <button class:active={ws.current === path} aria-current={ws.current === path ? "page" : undefined} onclick={() => open(path)}>
          {ws.title(path)}
        </button>
      </li>
    {/each}
  </ul>
  <h2>Pages</h2>
  <ul>
    {#each ws.pages as path (path)}
      <li>
        <button class:active={ws.current === path} aria-current={ws.current === path ? "page" : undefined} onclick={() => open(path)}>
          {ws.title(path)}
        </button>
      </li>
    {/each}
    {#if ws.pages.length === 0}<li class="none">No pages yet</li>{/if}
  </ul>
</nav>
