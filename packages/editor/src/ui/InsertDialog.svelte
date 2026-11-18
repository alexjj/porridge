<script lang="ts">
  import Modal from "./Modal.svelte";
  import { suggestAlt } from "../model/images.js";
  import { snippet } from "../store/commands.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let { ws }: { ws: Workspace } = $props();

  // The dialog is created for one request, so start from it.
  // svelte-ignore state_referenced_locally
  const req = ws.inserting!;

  let text = $state(req.selected);
  let url = $state(/^https?:\/\//.test(req.selected) ? req.selected : "");
  let alt = $state(req.file ? suggestAlt(req.file.name) : "");
  let busy = $state(false);
  let problem = $state("");
  const previewUrl = req.file ? URL.createObjectURL(req.file) : "";

  $effect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });

  function close() {
    ws.inserting = null;
  }

  /** Close first (an open modal makes the outline inert), then insert and focus. */
  function insert(markdown: string) {
    const before = (findText(req.id) ?? "").slice(0, req.start);
    close();
    ws.insertInto(req.id, req.start, req.end, snippet(before, markdown));
  }

  function findText(id: string): string | undefined {
    const stack = [...(ws.file?.nodes ?? [])];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.id === id) return n.text;
      stack.push(...n.children);
    }
    return undefined;
  }

  function addLink(e: SubmitEvent) {
    e.preventDefault();
    let href = url.trim();
    if (!href) return;
    if (!/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(href)) href = `https://${href}`;
    const label = (text.trim() || href).replace(/([[\]])/g, "\\$1");
    insert(`[${label}](${href.replace(/\)/g, "%29").replace(/ /g, "%20")})`);
  }

  async function addImage(e: SubmitEvent) {
    e.preventDefault();
    if (!req.file) return;
    busy = true;
    problem = "";
    try {
      const path = await ws.addImage(req.file);
      insert(`![${alt.trim().replace(/([[\]])/g, "\\$1")}](/${path})`);
    } catch (err) {
      problem = (err as Error).message;
      busy = false;
    }
  }
</script>

{#if req.kind === "link"}
  <Modal title="Add link" onclose={close}>
    <form class="form" onsubmit={addLink}>
      <label>Address <input type="text" inputmode="url" bind:value={url} placeholder="https://…" required autocomplete="off" /></label>
      <label>Text <input bind:value={text} placeholder="Shown instead of the address" /></label>
      <div class="actions"><button class="primary" type="submit">Add link</button></div>
    </form>
  </Modal>
{:else}
  <Modal title="Add image" onclose={close}>
    <form class="form" onsubmit={addImage}>
      {#if previewUrl}<img class="image-preview" src={previewUrl} alt="" />{/if}
      <div class="field">
        <label for="image-alt">Description</label>
        <input id="image-alt" bind:value={alt} placeholder="What's in the picture" aria-describedby="image-alt-hint" />
        <span id="image-alt-hint" class="field-hint">Read out by screen readers, and shown if the image can't load.</span>
      </div>
      {#if problem}<p class="field-problem" role="alert">{problem}</p>{/if}
      <p class="field-hint">Large photos are resized. The image uploads the next time you save or publish.</p>
      <div class="actions"><button class="primary" type="submit" disabled={busy}>{busy ? "Preparing…" : "Add image"}</button></div>
    </form>
  </Modal>
{/if}
