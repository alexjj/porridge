<script lang="ts">
  import { STARTER } from "../store/starter.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let {
    ws,
    ontogglesidebar,
    ontogglepanel,
  }: { ws: Workspace; ontogglesidebar: () => void; ontogglepanel: () => void } = $props();

  let menuOpen = $state(false);
  let folderInput: HTMLInputElement | undefined = $state();

  const statusText = $derived(
    { loading: "Loading…", saving: "Saving…", saved: "Saved in this browser", error: "Not saved" }[ws.status],
  );

  async function importFolder(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const texts: Record<string, string> = {};
    for (const f of Array.from(input.files ?? [])) {
      // "my-blog/pages/about.opml" → "pages/about.opml"
      const path = (f.webkitRelativePath || f.name).split("/").slice(1).join("/");
      if (/^(blog\.opml|blog\/\d{4}\.opml|pages\/[^/]+\.opml)$/.test(path)) texts[path] = await f.text();
    }
    input.value = "";
    if (!confirm(`Replace everything in this browser with ${Object.keys(texts).length} files from that folder?`)) return;
    try {
      ws.replaceAll(texts);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  function reset() {
    menuOpen = false;
    if (!confirm("Replace everything in this browser with the starter blog? Your changes here will be lost.")) return;
    ws.replaceAll(STARTER);
  }

  function choose(fn: () => void) {
    menuOpen = false;
    fn();
  }
</script>

<svelte:window onclick={(e) => { if (menuOpen && !(e.target as HTMLElement).closest(".menu")) menuOpen = false; }} />

<header class="topbar">
  <button class="icon only-narrow" aria-label="Files" onclick={ontogglesidebar}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
  </button>
  <span class="brand">porridge</span>
  <span class="status" class:error={ws.status === "error"} title={ws.error}>{statusText}</span>
  <span class="spacer"></span>
  <button class="primary" aria-label="New entry" onclick={() => ws.newEntry()}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
    <span>New entry</span>
  </button>
  <button class="icon only-medium" aria-label="Help and preview" onclick={ontogglepanel}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="1.5" /><path d="M12 4v12" /></svg>
  </button>
  <div class="menu">
    <button class="icon" aria-label="More" aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="16" cy="10" r="1.4" /></svg>
    </button>
    {#if menuOpen}
      <div class="menu-list" role="menu">
        <button role="menuitem" onclick={() => choose(() => ws.downloadCurrent())}>Download this file</button>
        <button role="menuitem" onclick={() => choose(() => ws.downloadAll())}>Download all (.zip)</button>
        <button role="menuitem" onclick={() => choose(() => folderInput?.click())}>Open a blog folder…</button>
        <hr />
        <button role="menuitem" class="danger" onclick={reset}>Reset to starter blog</button>
      </div>
    {/if}
  </div>
  <input bind:this={folderInput} type="file" webkitdirectory hidden onchange={importFolder} />
</header>
{#if ws.error && ws.status !== "error"}
  <div class="banner" role="alert">{ws.error} <button onclick={() => (ws.error = "")}>Dismiss</button></div>
{/if}
{#if ws.status === "error"}
  <div class="banner" role="alert">{ws.error}</div>
{/if}
