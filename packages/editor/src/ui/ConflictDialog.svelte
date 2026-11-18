<script lang="ts">
  import Modal from "./Modal.svelte";
  import type { Remote } from "../store/remote.svelte.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let { ws, remote }: { ws: Workspace; remote: Remote } = $props();
  const paths = $derived(remote.conflictPrompt?.paths ?? []);
</script>

<Modal title="Changed in two places" onclose={() => remote.resolve("cancel")}>
  <p>Since this browser last synced, GitHub got a different version of:</p>
  <ul class="conflict-list">
    {#each paths as p (p)}<li><strong>{ws.title(p)}</strong> <span class="muted">{p}</span></li>{/each}
  </ul>
  <p>Which version do you want to keep? The other is replaced (it stays in the repository's history).</p>
  {#snippet footer()}
    <button class="secondary" onclick={() => ws.downloadAll()}>Download mine first</button>
    <span class="spacer"></span>
    <button class="secondary" onclick={() => remote.resolve("theirs")}>Use GitHub's</button>
    <button class="primary" onclick={() => remote.resolve("mine")}>Keep mine</button>
  {/snippet}
</Modal>
