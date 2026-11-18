<script lang="ts">
  import ConflictDialog from "./ConflictDialog.svelte";
  import EditToolbar from "./EditToolbar.svelte";
  import InsertDialog from "./InsertDialog.svelte";
  import NodeMenu from "./NodeMenu.svelte";
  import OutlineView from "./OutlineView.svelte";
  import PageDialog from "./PageDialog.svelte";
  import RightPanel from "./RightPanel.svelte";
  import SettingsDialog from "./SettingsDialog.svelte";
  import Sidebar from "./Sidebar.svelte";
  import TopBar from "./TopBar.svelte";
  import { startInsert, type Range } from "../store/commands.js";
  import type { ENode } from "../model/tree.js";
  import type { Remote } from "../store/remote.svelte.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let { ws, remote }: { ws: Workspace; remote: Remote } = $props();

  let sidebarOpen = $state(false);
  let panelOpen = $state(false);
  let settingsTab: "blog" | "github" | null = $state(null);
  /** Page whose settings are open; "" for a new page; null for none. */
  let pageDialog: string | null = $state(null);

  // Phones and tablets: the line menu is a bottom sheet and the editing toolbar shows.
  const query = window.matchMedia("(max-width: 760px), (pointer: coarse)");
  let compact = $state(query.matches);
  $effect(() => {
    const update = () => (compact = query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });

  // The photo picker has to open straight from the tap, so it lives here.
  let imageInput: HTMLInputElement | undefined = $state();
  let imageFor: { node: ENode; range: Range | null } | null = null;
  $effect(() => {
    ws.pickImage = (node, range) => {
      imageFor = { node, range };
      imageInput?.click();
    };
  });
  function onImagePicked() {
    const file = imageInput?.files?.[0];
    if (imageInput) imageInput.value = "";
    if (file && imageFor) startInsert(ws, "image", imageFor.node, imageFor.range, file);
    imageFor = null;
  }

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
{#if ws.menu}
  <NodeMenu {ws} sheet={compact} />
{/if}
{#if ws.inserting}
  {#key ws.inserting}<InsertDialog {ws} />{/key}
{/if}
{#if compact && ws.editingId && !ws.inserting && !ws.menu}
  <EditToolbar {ws} />
{/if}
{#if ws.toast}
  <div class="toast" role="status">{ws.toast}</div>
{/if}
<input bind:this={imageInput} type="file" accept="image/*" hidden onchange={onImagePicked} data-testid="image-input" />
