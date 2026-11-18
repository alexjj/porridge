<script lang="ts">
  import OutlineView from "./OutlineView.svelte";
  import RightPanel from "./RightPanel.svelte";
  import Sidebar from "./Sidebar.svelte";
  import TopBar from "./TopBar.svelte";
  import type { Workspace } from "../store/workspace.svelte.js";

  let { ws }: { ws: Workspace } = $props();

  let sidebarOpen = $state(false);
  let panelOpen = $state(false);
</script>

<svelte:window onbeforeunload={() => void ws.flush()} />
<svelte:document onvisibilitychange={() => document.visibilityState === "hidden" && void ws.flush()} />

<div class="app" class:sidebar-open={sidebarOpen} class:panel-open={panelOpen}>
  <TopBar
    {ws}
    ontogglesidebar={() => (sidebarOpen = !sidebarOpen)}
    ontogglepanel={() => (panelOpen = !panelOpen)}
  />
  <div class="columns">
    <Sidebar {ws} onnavigate={() => (sidebarOpen = false)} />
    <main class="main">
      {#if ws.status === "loading"}
        <p class="loading">Loading…</p>
      {:else}
        <OutlineView {ws} />
      {/if}
    </main>
    <RightPanel {ws} />
  </div>
  <button class="scrim" aria-label="Close" tabindex="-1" onclick={() => { sidebarOpen = false; panelOpen = false; }}></button>
</div>
