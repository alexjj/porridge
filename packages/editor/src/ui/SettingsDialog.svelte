<script lang="ts">
  import Modal from "./Modal.svelte";
  import { parseRepo, type Connection } from "../github/api.js";
  import { fileHead } from "../model/tree.js";
  import type { Remote } from "../store/remote.svelte.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  let {
    ws,
    remote,
    tab = $bindable("blog"),
    onclose,
  }: { ws: Workspace; remote: Remote; tab?: "blog" | "github"; onclose: () => void } = $props();

  // ---- Blog settings -------------------------------------------------------

  const blog = $derived(ws.files["blog.opml"]);
  const value = (name: string) => (blog ? (fileHead(blog, name) ?? "") : "");
  const set = (name: string) => (e: Event) => ws.setHead("blog.opml", name, (e.currentTarget as HTMLInputElement).value);

  const timezones: string[] = (() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  })();

  const baseUrlProblem = $derived.by(() => {
    const v = value("porridge:baseUrl");
    if (!v) return "Required: the address your blog is published at.";
    if (!/^https?:\/\/[^/]+/.test(v)) return "Start with https://";
    if (v.includes("YOUR-USERNAME") || v.includes("YOUR-REPO")) return "Replace the placeholder with your blog's GitHub Pages address.";
    return "";
  });

  // ---- GitHub ---------------------------------------------------------------

  // The form starts from the saved connection.
  // svelte-ignore state_referenced_locally
  const saved = remote.conn;
  let repo = $state(saved ? `${saved.owner}/${saved.repo}` : "");
  let branch = $state(saved?.branch ?? "main");
  let workflow = $state(saved?.workflow ?? "build.yml");
  let token = $state(saved?.token ?? "");
  let working = $state(false);
  let problem = $state("");

  async function connect() {
    problem = "";
    const parsed = parseRepo(repo);
    if (!parsed) {
      problem = "Enter the repository as owner/name.";
      return;
    }
    if (!token.trim()) {
      problem = "Enter a token.";
      return;
    }
    const conn: Connection = { ...parsed, branch: branch.trim() || "main", token: token.trim(), workflow: workflow.trim() || "build.yml" };
    working = true;
    try {
      const check = await remote.inspect(conn);
      const question = check.hasBlog
        ? `Load the blog from ${parsed.owner}/${parsed.repo}? It replaces what's in this browser now. (Use "Download all" in the menu first if you want a copy.)`
        : `${parsed.owner}/${parsed.repo} has no blog.opml yet. Upload the blog in this browser to it?`;
      if (!confirm(question)) return;
      await remote.connect(conn, check);
      onclose();
    } catch (err) {
      problem = (err as Error).message;
    } finally {
      working = false;
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect from GitHub? Your blog stays in this browser, and the token is forgotten.")) return;
    await remote.disconnect();
    token = "";
  }
</script>

<Modal title="Settings" {onclose} wide>
  <div class="tabs modal-tabs" role="tablist">
    <button role="tab" aria-selected={tab === "blog"} class:active={tab === "blog"} onclick={() => (tab = "blog")}>Blog</button>
    <button role="tab" aria-selected={tab === "github"} class:active={tab === "github"} onclick={() => (tab = "github")}>GitHub</button>
  </div>

  {#if tab === "blog"}
    {#if blog}
      <div class="form">
        <label>Title <input value={value("title")} oninput={set("title")} /></label>
        <label>Description <input value={value("description")} oninput={set("description")} placeholder="Shown under the title and in the feed" /></label>
        <label>Your name <input value={value("ownerName")} oninput={set("ownerName")} /></label>
        <div class="field">
          <label for="set-baseurl">Site address</label>
          <input id="set-baseurl" type="url" value={value("porridge:baseUrl")} oninput={set("porridge:baseUrl")} placeholder="https://you.github.io/blog/" aria-describedby="set-baseurl-problem" />
          <span id="set-baseurl-problem" class="field-problem">{baseUrlProblem}</span>
        </div>
        <div class="field">
          <label for="set-tz">Timezone</label>
          <input id="set-tz" list="timezones" value={value("porridge:timezone")} oninput={set("porridge:timezone")} placeholder="UTC" aria-describedby="set-tz-hint" />
          <span id="set-tz-hint" class="field-hint">Decides which day a new entry goes under.</span>
        </div>
        <datalist id="timezones">{#each timezones as tz (tz)}<option value={tz}></option>{/each}</datalist>
        <div class="row-2">
          <label>Days on the home page <input type="number" min="1" value={value("porridge:homeDays")} oninput={set("porridge:homeDays")} placeholder="10" /></label>
          <label>Entries in the feed <input type="number" min="1" value={value("porridge:rssItems")} oninput={set("porridge:rssItems")} placeholder="25" /></label>
        </div>
        <label>Language <input value={value("porridge:language")} oninput={set("porridge:language")} placeholder="en" /></label>
        <p class="field-hint">Changes are kept as you type. Save or Publish to put them on GitHub.</p>
      </div>
    {:else}
      <p>There's no blog.opml in this workspace.</p>
    {/if}
  {:else}
    <div class="form">
      {#if remote.conn}
        <p class="connected">Connected to <strong>{remote.repoName}</strong> ({remote.conn.branch}).</p>
      {:else}
        <p>Connect a GitHub repository made from the porridge template. The editor reads and writes it directly from this browser.</p>
      {/if}
      <label>Repository <input bind:value={repo} placeholder="you/your-blog" autocomplete="off" spellcheck="false" disabled={!!remote.conn} /></label>
      <div class="row-2">
        <label>Branch <input bind:value={branch} spellcheck="false" disabled={!!remote.conn} /></label>
        <label>Build workflow <input bind:value={workflow} spellcheck="false" disabled={!!remote.conn} /></label>
      </div>
      <div class="field">
        <label for="gh-token">Token</label>
        <input id="gh-token" type="password" bind:value={token} autocomplete="off" spellcheck="false" disabled={!!remote.conn} aria-describedby="gh-token-hint" />
        <span id="gh-token-hint" class="field-hint">
          A <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>
          for just this repository, with <strong>Contents</strong> and <strong>Actions</strong> set to read and write. It's kept only in this browser.
        </span>
      </div>
      {#if problem}<p class="field-problem" role="alert">{problem}</p>{/if}
      <div class="actions">
        {#if remote.conn}
          <button class="secondary" onclick={disconnect}>Disconnect</button>
        {:else}
          <button class="primary" onclick={connect} disabled={working}>{working ? "Connecting…" : "Connect"}</button>
        {/if}
      </div>
    </div>
  {/if}
</Modal>
