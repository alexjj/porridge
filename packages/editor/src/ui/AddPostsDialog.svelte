<script lang="ts">
  import Modal from "./Modal.svelte";
  import { planDownload, readMedia, type DownloadPlan } from "../store/addPosts.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let { ws, onclose }: { ws: Workspace; onclose: () => void } = $props();

  let plan = $state.raw<DownloadPlan | null>(null);
  let busy = $state(false);
  let problem = $state("");
  let added = $state<number | null>(null);

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const years = $derived.by(() => {
    if (!plan?.posts.length) return "";
    const first = plan.posts[0]!.date.slice(0, 4);
    const last = plan.posts.at(-1)!.date.slice(0, 4);
    return first === last ? first : `${first} to ${last}`;
  });

  async function choose(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    problem = "";
    busy = true;
    try {
      plan = await planDownload(file, ws.files);
    } catch (err) {
      problem = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function run() {
    if (!plan) return;
    busy = true;
    problem = "";
    try {
      added = await ws.importPosts(plan.posts, await readMedia(plan));
    } catch (err) {
      problem = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Add posts from a download" {onclose}>
  <div class="form import-mb">
    {#if added !== null}
      <p role="status"><strong>Added {plural(added, "post")}.</strong> They're in your outline now.</p>
      <p>Save puts them on GitHub; Undo takes them back out.</p>
      <div class="actions"><button class="primary" onclick={onclose}>Done</button></div>
    {:else if !plan}
      <p>
        Bring posts back from a <strong>Download all (.zip)</strong>, for example after trying an import in another tab. Posts this blog
        doesn't have yet are added on their days, with their photos.
      </p>
      <p class="field-hint">Posts already here, the example blog's posts, pages and settings are left as they are.</p>
      <div class="field">
        <label for="add-file">Porridge download (.zip)</label>
        <input id="add-file" type="file" accept=".zip,application/zip" onchange={choose} disabled={busy} />
      </div>
      {#if busy}<p role="status">Reading…</p>{/if}
    {:else}
      {#if plan.posts.length}
        <p>
          <strong>{plural(plan.posts.length, "new post")}</strong> from {years}{plan.media.length
            ? `, with ${plural(plan.media.length, "photo or video", "photos and videos")}`
            : ""}.
        </p>
      {:else}
        <p>There are no new posts in this download.</p>
      {/if}
      <ul class="import-facts">
        {#if plan.existing}<li>{plural(plan.existing, "post")} already in this blog will be left as {plan.existing === 1 ? "it is" : "they are"}.</li>{/if}
        {#if plan.examples}<li>{plural(plan.examples, "example post")} from the starter blog will be left out.</li>{/if}
      </ul>
      <div class="actions">
        <button class="secondary" onclick={() => (plan = null)}>Choose another file</button>
        {#if plan.posts.length}
          <button class="primary" onclick={run} disabled={busy}>{busy ? "Adding…" : `Add ${plural(plan.posts.length, "post")}`}</button>
        {/if}
      </div>
    {/if}
    {#if problem}<p class="field-problem" role="alert">{problem}</p>{/if}
  </div>
</Modal>
