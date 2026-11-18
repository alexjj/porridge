<script lang="ts">
  import ConflictDialog from "./ConflictDialog.svelte";
  import OutlineView from "./OutlineView.svelte";
  import PageDialog from "./PageDialog.svelte";
  import RightPanel from "./RightPanel.svelte";
  import SettingsDialog from "./SettingsDialog.svelte";
  import Sidebar from "./Sidebar.svelte";
  import TopBar from "./TopBar.svelte";
  import type { Remote } from "../store/remote.svelte.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let { ws, remote }: { ws: Workspace; remote: Remote } = $props();

  let sidebarOpen = $state(false);
  let panelOpen = $state(false);
  let settingsTab: "blog" | "github" | null = $state(null);
  /** Page whose settings are open; "" for a new page; null for none. */
  let pageDialog: string | null = $state(null);

  function onkeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (remote.conn) void remote.save(false);
      else void ws.flush();
    }
  }
</script>

<svelte:window onbeforeunload={() => void ws.flush()} {onkeydown} />
<svelte:document onvisibilitychange={() => document.visibilityState === "hidden" && void ws.flush()} />

<div class="app" class:sidebar-open={sidebarOpen} class:panel-open={panelOpen}>
  <TopBar
    {ws}
    {remote}
    ontogglesidebar={() => (sidebarOpen = !sidebarOpen)}
    ontogglepanel={() => (panelOpen = !panelOpen)}
    onsettings={(tab) => (settingsTab = tab)}
  />
  <div class="columns">
    <Sidebar {ws} {remote} onnavigate={() => (sidebarOpen = false)} onnewpage={() => (pageDialog = "")} />
    <main class="main">
      {#if ws.status === "loading"}
        <p class="loading">Loading…</p>
      {:else}
        <OutlineView {ws} onpagesettings={(path) => (pageDialog = path)} />
      {/if}
    </main>
    <RightPanel {ws} />
  </div>
  <button class="scrim" aria-label="Close" tabindex="-1" onclick={() => { sidebarOpen = false; panelOpen = false; }}></button>
</div>

{#if settingsTab}
  <SettingsDialog {ws} {remote} tab={settingsTab} onclose={() => (settingsTab = null)} />
{/if}
{#if pageDialog !== null}
  <PageDialog {ws} path={pageDialog || null} onclose={() => (pageDialog = null)} />
{/if}
{#if remote.conflictPrompt}
  <ConflictDialog {ws} {remote} />
{/if}
