<script lang="ts">
  import Modal from "./Modal.svelte";
  import { fileHead, pageSlug } from "../model/tree.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  /** `path` null means "new page". */
  let { ws, path, onclose }: { ws: Workspace; path: string | null; onclose: () => void } = $props();

  // ---- New page ------------------------------------------------------------

  let newTitle = $state("");
  let newInNav = $state(true);

  function create(e: SubmitEvent) {
    e.preventDefault();
    // Close first: an open modal dialog makes the outline inert, so the new
    // page's first line couldn't take focus.
    onclose();
    ws.newPage(newTitle, newInNav);
  }

  // ---- Existing page --------------------------------------------------------

  // The page's path changes if it's renamed while the dialog is open, so
  // start from the prop and track it locally.
  // svelte-ignore state_referenced_locally
  let current = $state(path);
  const file = $derived(current ? ws.files[current] : undefined);
  const value = (name: string) => (file ? (fileHead(file, name) ?? "") : "");
  const set = (name: string, v: string) => current && ws.setHead(current, name, v);

  // svelte-ignore state_referenced_locally
  let slug = $state(path ? pageSlug(path) : "");
  let renameProblem = $state("");

  function rename() {
    if (!current) return;
    const problem = ws.renamePage(current, slug.trim());
    renameProblem = problem ?? "";
    if (!problem) current = `pages/${slug.trim()}.opml`;
  }

  function remove() {
    if (!current || !confirm(`Delete the page "${ws.title(current)}"? It's removed from GitHub the next time you save.`)) return;
    ws.deletePage(current);
    onclose();
  }
</script>

{#if path === null}
  <Modal title="New page" {onclose}>
    <form class="form" onsubmit={create}>
      <label>Title <input bind:value={newTitle} placeholder="About, Books, Now…" required /></label>
      <label class="check"><input type="checkbox" bind:checked={newInNav} /> Show in the site's navigation</label>
      <div class="actions"><button class="primary" type="submit">Create page</button></div>
    </form>
  </Modal>
{:else if file}
  <Modal title="Page settings" {onclose}>
    <div class="form">
      <label>Title <input value={value("title")} oninput={(e) => set("title", e.currentTarget.value)} /></label>
      <label class="check">
        <input type="checkbox" checked={value("porridge:inNav") === "true"} onchange={(e) => set("porridge:inNav", e.currentTarget.checked ? "true" : "")} />
        Show in the site's navigation
      </label>
      {#if value("porridge:inNav") === "true"}
        <div class="row-2">
          <label>Navigation label <input value={value("porridge:navLabel")} placeholder={value("title")} oninput={(e) => set("porridge:navLabel", e.currentTarget.value)} /></label>
          <label>Order <input type="number" value={value("porridge:navOrder")} placeholder="100" oninput={(e) => set("porridge:navOrder", e.currentTarget.value)} /></label>
        </div>
      {/if}
      <label class="check">
        <input type="checkbox" checked={value("porridge:isDraft") === "true"} onchange={(e) => set("porridge:isDraft", e.currentTarget.checked ? "true" : "")} />
        Draft (not published)
      </label>
      <div class="field">
        <span id="address-label">Address</span>
        <span class="inline-field" role="group" aria-labelledby="address-label">
          <span class="prefix">/</span><input bind:value={slug} spellcheck="false" aria-label="Page address" /><span class="prefix">/</span>
          <button class="secondary" onclick={rename} disabled={!current || slug.trim() === pageSlug(current)}>Rename</button>
        </span>
        {#if renameProblem}<span class="field-problem">{renameProblem}</span>{/if}
      </div>
      <div class="actions spread">
        <button class="danger-button" onclick={remove}>Delete page</button>
        <button class="primary" onclick={onclose}>Done</button>
      </div>
    </div>
  </Modal>
{/if}
