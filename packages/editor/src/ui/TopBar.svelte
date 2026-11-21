<script lang="ts">
  import { STARTER } from "../store/starter.js";
  import type { Remote } from "../store/remote.svelte.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let {
    ws,
    remote,
    ontogglesidebar,
    ontogglepanel,
    onsettings,
  }: {
    ws: Workspace;
    remote: Remote;
    ontogglesidebar: () => void;
    ontogglepanel: () => void;
    onsettings: (tab: "blog" | "github") => void;
  } = $props();

  let menuOpen = $state(false);
  let folderInput: HTMLInputElement | undefined = $state();

  const unsaved = $derived(remote.unsynced.length);

  /** One line saying where the work stands. */
  const status = $derived.by((): { text: string; tone?: "error" | "good"; href?: string } => {
    if (ws.status === "error") return { text: "Not saved", tone: "error" };
    if (ws.status === "loading") return { text: "Loading…" };
    if (!remote.conn) return { text: ws.status === "saving" ? "Saving…" : "Saved in this browser" };
    if (remote.busy === "checking") return { text: "Checking GitHub…" };
    if (remote.busy === "saving") return { text: "Saving to GitHub…" };
    const b = remote.build;
    if (remote.busy === "publishing" && (!b || b.state !== "done")) {
      return b?.state === "running" ? { text: "Building site…", href: b.url } : { text: "Publishing…" };
    }
    if (remote.error) return { text: "GitHub problem", tone: "error" };
    if (unsaved) return { text: `${unsaved} unsaved ${unsaved === 1 ? "change" : "changes"}` };
    if (b?.state === "done") {
      return b.ok ? { text: "Published", tone: "good", href: ws.siteBase !== "/" ? ws.siteBase : b.url } : { text: "Build failed", tone: "error", href: b.url };
    }
    return { text: "Saved to GitHub" };
  });

  async function importFolder(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const texts: Record<string, string> = {};
    for (const f of Array.from(input.files ?? [])) {
      // "my-blog/pages/about.opml" → "pages/about.opml"
      const path = (f.webkitRelativePath || f.name).split("/").slice(1).join("/");
      if (/^(blog\.opml|blog\/\d{4}\.opml|pages\/[^/]+\.opml)$/.test(path)) texts[path] = await f.text();
    }
    input.value = "";
    if (!confirm(`Replace everything in this browser with ${Object.keys(texts).length} files from that folder?`)) return;
    try {
      ws.replaceAll(texts);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  function reset() {
    if (!confirm("Replace everything in this browser with the starter blog? Your changes here will be lost.")) return;
    ws.replaceAll(STARTER);
  }

  function choose(fn: () => void) {
    menuOpen = false;
    fn();
  }
</script>

<svelte:window onclick={(e) => { if (menuOpen && !(e.target as HTMLElement).closest(".menu")) menuOpen = false; }} />

<header class="topbar">
  <button class="icon only-narrow" aria-label="Files" onclick={ontogglesidebar}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
  </button>
  <span class="brand">porridge</span>
  <span class="status" class:error={status.tone === "error"} class:good={status.tone === "good"} role="status" title={remote.error || ws.error}>
    {#if status.href}<a href={status.href} target="_blank" rel="noopener">{status.text}</a>{:else}{status.text}{/if}
  </span>
  <span class="spacer"></span>

  {#if remote.conn}
    <button
      class="secondary"
      aria-label="Save"
      title={unsaved ? `Save ${remote.unsynced.join(", ")} to GitHub (${navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}-S)` : "Everything is saved to GitHub"}
      disabled={!!remote.busy || !unsaved}
      onclick={() => remote.save(false)}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V4M6 8l4-4 4 4M4 16h12" /></svg>
      <span>Save</span>
    </button>
    <button
      class="secondary"
      aria-label="Publish"
      title="Save and rebuild the site"
      disabled={!!remote.busy}
      onclick={() => remote.save(true)}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2.5 2.5 2.5 11.5 0 14M10 3c-2.5 2.5-2.5 11.5 0 14" /></svg>
      <span>Publish</span>
    </button>
  {:else if ws.status !== "loading"}
    <button class="secondary" aria-label="Connect GitHub" onclick={() => onsettings("github")}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 12l4-4M7 9l-2 2a3 3 0 0 0 4 4l2-2M13 11l2-2a3 3 0 0 0-4-4L9 7" /></svg>
      <span>Connect GitHub</span>
    </button>
  {/if}

  {#if ws.siteBase !== "/"}
    <a class="icon" href={ws.siteBase} target="_blank" rel="noopener" aria-label="View site" title="View your site ({ws.siteBase})">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5" /></svg>
    </a>
  {/if}

  <button class="primary" aria-label="New entry" onclick={() => ws.newEntry()}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
    <span>New entry</span>
  </button>
  <button class="icon only-medium" aria-label="Help and preview" onclick={ontogglepanel}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="1.5" /><path d="M12 4v12" /></svg>
  </button>
  <div class="menu">
    <button class="icon" aria-label="More" aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="16" cy="10" r="1.4" /></svg>
    </button>
    {#if menuOpen}
      <div class="menu-list" role="menu">
        <button role="menuitem" onclick={() => choose(() => onsettings("blog"))}>Blog settings…</button>
        <button role="menuitem" onclick={() => choose(() => onsettings("github"))}>GitHub…</button>
        {#if remote.conn}
          <button role="menuitem" onclick={() => choose(() => void remote.check())} disabled={!!remote.busy}>Check GitHub for changes</button>
        {/if}
        <hr />
        <button role="menuitem" onclick={() => choose(() => ws.downloadCurrent())}>Download this file</button>
        <button role="menuitem" onclick={() => choose(() => ws.downloadAll())}>Download all (.zip)</button>
        {#if !remote.conn}
          <button role="menuitem" onclick={() => choose(() => folderInput?.click())}>Open a blog folder…</button>
          <hr />
          <button role="menuitem" class="danger" onclick={() => choose(reset)}>Reset to starter blog</button>
        {/if}
      </div>
    {/if}
  </div>
  <input bind:this={folderInput} type="file" webkitdirectory hidden onchange={importFolder} />
</header>
{#if remote.error}
  <div class="banner" role="alert">{remote.error} <button onclick={() => (remote.error = "")}>Dismiss</button></div>
{:else if remote.conflicts.length && !remote.conflictPrompt}
  <div class="banner" role="alert">
    Also changed on GitHub: {remote.conflicts.map((p) => ws.title(p)).join(", ")}. Saving will ask which version to keep.
  </div>
{/if}
{#if ws.error}
  <div class="banner" role="alert">{ws.error} {#if ws.status !== "error"}<button onclick={() => (ws.error = "")}>Dismiss</button>{/if}</div>
{/if}
