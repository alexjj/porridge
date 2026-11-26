<script lang="ts">
  import Modal from "./Modal.svelte";
  import { planArchive, prepareMedia, type ArchivePlan } from "../store/microblog.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let { ws, onclose }: { ws: Workspace; onclose: () => void } = $props();

  type Stage = "choose" | "reading" | "summary" | "working" | "done";
  let stage: Stage = $state("choose");
  let problem = $state("");
  let plan = $state.raw<ArchivePlan | null>(null);
  let done = $state(0);
  let total = $state(0);
  let added = $state(0);
  let mediaProblems: string[] = $state([]);
  let cancelled = false;

  const years = $derived.by(() => {
    if (!plan || plan.posts.length === 0) return "";
    const first = plan.posts[0]!.date.slice(0, 4);
    const last = plan.posts.at(-1)!.date.slice(0, 4);
    return first === last ? first : `${first} to ${last}`;
  });
  const videos = $derived(plan ? plan.media.filter((m) => m.kind === "video").length : 0);
  const toCheck = $derived(plan ? plan.posts.filter((p) => p.notes.length).sort((a, b) => (a.date < b.date ? 1 : -1)) : []);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  async function choose(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    problem = "";
    stage = "reading";
    try {
      plan = await planArchive(file, ws.timezone, ws.importedAddresses());
      stage = "summary";
    } catch (err) {
      problem = (err as Error).message;
      stage = "choose";
    }
  }

  async function run() {
    if (!plan) return;
    stage = "working";
    cancelled = false;
    total = plan.media.length;
    done = 0;
    try {
      const { files, problems } = await prepareMedia(plan, (d) => {
        done = d;
        if (cancelled) throw new Error("cancelled");
      });
      mediaProblems = problems;
      added = await ws.importPosts(plan.posts, files);
      stage = "done";
    } catch (err) {
      if ((err as Error).message === "cancelled") {
        stage = "summary";
        return;
      }
      problem = (err as Error).message;
      stage = "summary";
    }
  }

  /** Close, then show an imported post in the outline. */
  function show(url: string) {
    onclose();
    ws.revealImported(url);
  }
</script>

<Modal title="Import from micro.blog" onclose={() => {
  if (stage === "working") cancelled = true;
  onclose();
}} wide>
  <div class="form import-mb">
    {#if stage === "choose" || stage === "reading"}
      <p>
        Bring in your posts and photos from a micro.blog <strong>Blog Archive</strong>. On micro.blog, go to Account → Export, choose
        "Blog Archive", and pick the <code>.bar</code> file it gives you.
      </p>
      <p class="field-hint">
        It's read here in your browser, however big it is. Posts go on their days, photos are made smaller like any other photo, and
        nothing reaches GitHub until you Save.
      </p>
      <div class="field">
        <label for="mb-file">Blog Archive (.bar)</label>
        <input id="mb-file" type="file" accept=".bar,.zip,application/zip" onchange={choose} disabled={stage === "reading"} />
      </div>
      {#if stage === "reading"}<p role="status">Reading the archive…</p>{/if}
    {:else if plan && stage === "summary"}
      {#if plan.posts.length === 0}
        <p>
          There's nothing new to import: {plural(plan.duplicates, "post")} in this archive {plan.duplicates === 1 ? "is" : "are"} already
          in your blog.
        </p>
      {:else}
        <p>
          <strong>{plural(plan.posts.length, "post")}</strong> from {years}, with
          {plural(plan.media.length - videos, "photo")}{videos ? ` and ${plural(videos, "video")}` : ""}.
        </p>
        <ul class="import-facts">
          {#if plan.duplicates}<li>{plural(plan.duplicates, "post")} already imported will be skipped.</li>{/if}
          {#if plan.missing.length}<li>{plural(plan.missing.length, "file")} posts use aren't in the archive; those posts keep the micro.blog address.</li>{/if}
          {#if plan.result.skipped.length}<li>{plural(plan.result.skipped.length, "post")} couldn't be read: {plan.result.skipped.join("; ")}.</li>{/if}
          {#if toCheck.length}<li>{plural(toCheck.length, "post")} {toCheck.length === 1 ? "has" : "have"} things worth a look afterwards (listed when it's done).</li>{/if}
          <li>Times are shown in your blog's timezone ({ws.timezone}).</li>
        </ul>
      {/if}
      {#if problem}<p class="field-problem" role="alert">{problem}</p>{/if}
      <div class="actions">
        <button class="secondary" onclick={() => ((plan = null), (stage = "choose"))}>Choose another file</button>
        {#if plan.posts.length}<button class="primary" onclick={run}>Import {plural(plan.posts.length, "post")}</button>{/if}
      </div>
    {:else if stage === "working"}
      <p role="status">Copying photos and videos: {done} of {total}</p>
      <progress max={total || 1} value={done}></progress>
      <p class="field-hint">Large photos are made smaller as they go. Keep this tab open.</p>
      <div class="actions"><button class="secondary" onclick={() => (cancelled = true)}>Stop</button></div>
    {:else if plan && stage === "done"}
      <p role="status"><strong>Imported {plural(added, "post")}.</strong> They're in your outline now.</p>
      <p>Save puts them on GitHub with their photos in one go; Publish rebuilds your site. Undo takes the whole import back out.</p>
      {#if mediaProblems.length}
        <details>
          <summary>{plural(mediaProblems.length, "file")} couldn't be copied (their posts keep the micro.blog address)</summary>
          <ul>{#each mediaProblems as p (p)}<li>{p}</li>{/each}</ul>
        </details>
      {/if}
      {#if toCheck.length}
        <p>Worth a look:</p>
        <ul class="import-check">
          {#each toCheck as p (p.url)}
            <li>
              <button class="link" onclick={() => show(p.url)}>{p.date} · {p.line.text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").slice(0, 60) || "(photo)"}</button>
              <span class="field-hint">{p.notes.join(", ")}</span>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="actions"><button class="primary" onclick={onclose}>Done</button></div>
    {/if}
  </div>
</Modal>
