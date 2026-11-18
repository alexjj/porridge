<script lang="ts">
  import { renderPreview, type Preview } from "../store/preview.js";
  import { MOD, SHORTCUTS } from "../store/keys.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let { ws }: { ws: Workspace } = $props();

  let tab: "help" | "preview" = $state("help");
  let preview: Preview | null = $state(null);
  /** The last node edited, so the preview stays on its day after editing stops. */
  let lastNode: string | null = $state(null);

  $effect(() => {
    if (ws.editingId) lastNode = ws.editingId;
  });

  $effect(() => {
    if (tab !== "preview") return;
    void ws.version;
    const file = ws.file;
    const node = ws.editingId ?? ws.zoom?.id ?? lastNode;
    const imageBase = ws.imageBase;
    const localImages = { ...ws.localImages };
    const timer = setTimeout(async () => {
      preview = await renderPreview(ws.texts(), file, node, imageBase, localImages);
    }, 250);
    return () => clearTimeout(timer);
  });
</script>

<aside class="panel">
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={tab === "help"} class:active={tab === "help"} onclick={() => (tab = "help")}>Help</button>
    <button role="tab" aria-selected={tab === "preview"} class:active={tab === "preview"} onclick={() => (tab = "preview")}>Preview</button>
  </div>

  {#if tab === "help"}
    <div class="help">
      <h3>Writing</h3>
      <dl class="syntax">
        <dt><code>**bold**</code></dt><dd><strong>bold</strong></dd>
        <dt><code>*italic*</code></dt><dd><em>italic</em></dd>
        <dt><code>`code`</code></dt><dd><code>code</code></dd>
        <dt><code>[text](https://…)</code></dt><dd>a link</dd>
        <dt><code>![alt](/images/…)</code></dt><dd>an image</dd>
        <dt><code>&lt;mark&gt;…&lt;/mark&gt;</code></dt><dd>HTML works too</dd>
      </dl>
      <h3>Posts</h3>
      <p>Each line under a day is an entry. A line with no children is a short post; a line with children becomes the post's title, and its children are the paragraphs.</p>
      <h3>Keys</h3>
      <dl class="keys">
        {#each SHORTCUTS as [key, what] (key)}
          <dt><kbd>{key}</kbd></dt><dd>{what}</dd>
        {/each}
      </dl>
      <p class="hint">Click a bullet for its menu: zoom in, add a link or image, copy its link, mark it as a draft, or delete it. {MOD}-[ zooms back out.</p>
      <p class="hint">To act on several lines at once, drag across them, Shift-click, or press Shift-↑/↓ at the start or end of a line. Then Tab, move or delete them together.</p>
    </div>
  {:else}
    <div class="preview">
      <div class="preview-label">{preview?.label ?? "Building…"}</div>
      {#if preview}
        <iframe title="Preview" sandbox="" srcdoc={preview.html}></iframe>
        {#if preview.warnings.length}
          <details class="warnings">
            <summary>{preview.warnings.length} warning{preview.warnings.length === 1 ? "" : "s"}</summary>
            <ul>{#each preview.warnings as w (w)}<li>{w}</li>{/each}</ul>
          </details>
        {/if}
      {/if}
    </div>
  {/if}
</aside>
