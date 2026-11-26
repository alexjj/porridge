<script lang="ts">
  import ConflictDialog from "./ConflictDialog.svelte";
  import EditToolbar from "./EditToolbar.svelte";
  import InsertDialog from "./InsertDialog.svelte";
  import NodeMenu from "./NodeMenu.svelte";
  import OutlineView from "./OutlineView.svelte";
  import PageDialog from "./PageDialog.svelte";
  import RightPanel from "./RightPanel.svelte";
  import SettingsDialog from "./SettingsDialog.svelte";
  import MicroblogDialog from "./MicroblogDialog.svelte";
  import Sidebar from "./Sidebar.svelte";
  import TopBar from "./TopBar.svelte";
  import { startInsert, type Range } from "../store/commands.js";
  import { handleSelectionKey } from "../store/keys.js";
  import { removeBlock } from "../model/ops.js";
  import type { ENode } from "../model/tree.js";
  import type { Remote } from "../store/remote.svelte.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let { ws, remote }: { ws: Workspace; remote: Remote } = $props();

  let sidebarOpen = $state(false);
  let panelOpen = $state(false);
  let settingsTab: "blog" | "github" | null = $state(null);
  let importing = $state(false);
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

  /** Ctrl/⌘-C and -X on selected lines: copy them (as a list), and for cut, remove them. */
  function copyOrCut(e: ClipboardEvent, cut: boolean) {
    if (!ws.selection || !e.clipboardData || ws.inserting || document.querySelector("dialog[open]")) return;
    const c = ws.selectionForClipboard();
    if (!c) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", c.text);
    e.clipboardData.setData("text/html", c.html);
    if (cut) {
      ws.blockOp("cut", (_t, b) => removeBlock(b));
      ws.clearSelection();
    }
    ws.notify(`${cut ? "Cut" : "Copied"} ${c.count} line${c.count === 1 ? "" : "s"}`);
  }

  function onkeydown(e: KeyboardEvent) {
    // Selected lines take the keys, unless something else (a dialog, a field) has focus.
    const target = e.target as HTMLElement;
    const free = target === document.body || !!target.closest?.(".main");
    const quiet = free && !ws.inserting && !ws.menu && !document.querySelector("dialog[open]");
    if (ws.selection && quiet) {
      if (handleSelectionKey(e, ws)) return;
    }
    // Undo still works when nothing is being edited (e.g. after deleting selected lines).
    if (quiet && !ws.editingId && (e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "z" || k === "y") {
        e.preventDefault();
        if (k === "y" || e.shiftKey) ws.redo();
        else ws.undo();
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (remote.conn) void remote.save(false);
      else void ws.flush();
    }
  }
</script>

<svelte:window
  onbeforeunload={() => void ws.flush()}
  {onkeydown}
  onpointerup={() => (ws.dragAnchor = null)}
  onpointerdown={(e) => {
    // Clicking outside the outline (and its toolbar and menus) clears a selection.
    const t = e.target as HTMLElement;
    if (ws.selection && !t.closest(".row, .edit-toolbar, .node-menu, .menu-scrim, dialog")) ws.clearSelection();
  }}
/>
<svelte:document
  onvisibilitychange={() => document.visibilityState === "hidden" && void ws.flush()}
  oncopy={(e) => copyOrCut(e, false)}
  oncut={(e) => copyOrCut(e, true)}
/>

<div class="app" class:sidebar-open={sidebarOpen} class:panel-open={panelOpen}>
  <TopBar
    {ws}
    {remote}
    ontogglesidebar={() => (sidebarOpen = !sidebarOpen)}
    ontogglepanel={() => (panelOpen = !panelOpen)}
    onsettings={(tab) => (settingsTab = tab)}
    onimport={() => (importing = true)}
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

{#if importing}
  <MicroblogDialog {ws} onclose={() => (importing = false)} />
{/if}
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
{#if compact && (ws.editingId || ws.selection) && !ws.inserting && !ws.menu}
  <EditToolbar {ws} />
{/if}
{#if ws.toast}
  <div class="toast" role="status">{ws.toast}</div>
{/if}
<input bind:this={imageInput} type="file" accept="image/*" hidden onchange={onImagePicked} data-testid="image-input" />
