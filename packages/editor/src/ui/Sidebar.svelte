<script lang="ts">
  import type { Remote } from "../store/remote.svelte.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let {
    ws,
    remote,
    onnavigate,
    onnewpage,
  }: { ws: Workspace; remote: Remote; onnavigate: () => void; onnewpage: () => void } = $props();

  function open(path: string) {
    ws.open(path);
    ws.zoomTo(null);
    onnavigate();
  }
</script>

{#snippet item(path: string)}
  <li>
    <button class:active={ws.current === path} aria-current={ws.current === path ? "page" : undefined} onclick={() => open(path)}>
      <span class="name">{ws.title(path)}</span>
      {#if remote.unsynced.includes(path)}<span class="unsaved" title="Not saved to GitHub yet" aria-label="(unsaved)"></span>{/if}
    </button>
  </li>
{/snippet}

<nav class="sidebar" aria-label="Files">
  <h2>Blog</h2>
  <ul>
    {#each ws.years as path (path)}{@render item(path)}{/each}
  </ul>
  <div class="side-head">
    <h2>Pages</h2>
    <button class="icon small" aria-label="New page" title="New page" onclick={() => { onnewpage(); onnavigate(); }}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg>
    </button>
  </div>
  <ul>
    {#each ws.pages as path (path)}{@render item(path)}{/each}
    {#if ws.pages.length === 0}<li class="none">No pages yet</li>{/if}
  </ul>
  {#if remote.conn}
    <p class="repo">
      <a href="https://github.com/{remote.conn.owner}/{remote.conn.repo}" target="_blank" rel="noopener">{remote.repoName}</a>
    </p>
  {/if}
</nav>
