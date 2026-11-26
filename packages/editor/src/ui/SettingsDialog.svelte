<script lang="ts">
  import { flushSync } from "svelte";
  import Modal from "./Modal.svelte";
  import { linkProblem } from "../model/nav.js";
  import { COLOR_TOKENS, DEFAULT_THEME, formatPalette, isSafeColor, parsePalette, THEMES, themeByName, type ColorToken, type Palette } from "@porridge/core";
  import { pagesUrl, parseRepo, type Connection } from "../github/api.js";
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
    if (!v) return "";
    if (!/^https?:\/\/[^/]+/.test(v)) return "Start with https://";
    if (v.includes("YOUR-USERNAME") || v.includes("YOUR-REPO")) return "Replace the placeholder with your blog's GitHub Pages address.";
    return "";
  });

  // ---- Navigation -------------------------------------------------------------

  const nav = $derived((ws.version, ws.navEntries()));

  function addLink() {
    const i = ws.addNavLink();
    flushSync();
    document.getElementById(`nav-label-${i}`)?.focus();
  }

  // ---- Colours ---------------------------------------------------------------

  const COLOR_LABELS: Record<ColorToken, string> = {
    bg: "Background",
    text: "Text",
    muted: "Quiet text",
    rule: "Lines",
    link: "Links",
    "link-hover": "Links (pointed at)",
  };
  const defaultTheme = themeByName(DEFAULT_THEME)!;
  const themeName = $derived(value("porridge:theme") || DEFAULT_THEME);
  const custom = $derived(themeName === "custom");
  const palette = (setting: string, base: Palette): Palette => ({ ...base, ...parsePalette(value(setting)).palette });
  const customLight = $derived(palette("porridge:colors", defaultTheme.light));
  const customDark = $derived(palette("porridge:darkColors", defaultTheme.dark));

  function chooseTheme(name: string) {
    if (name === "custom") {
      // Start from the colours showing now, unless custom ones were set before.
      const from = themeByName(themeName) ?? defaultTheme;
      if (!value("porridge:colors")) ws.setHead("blog.opml", "porridge:colors", formatPalette(from.light));
      if (!value("porridge:darkColors")) ws.setHead("blog.opml", "porridge:darkColors", formatPalette(from.dark));
    }
    ws.setHead("blog.opml", "porridge:theme", name === DEFAULT_THEME ? "" : name);
  }

  function setColor(mode: "light" | "dark", token: ColorToken, color: string) {
    const setting = mode === "light" ? "porridge:colors" : "porridge:darkColors";
    const current = mode === "light" ? customLight : customDark;
    ws.setHead("blog.opml", setting, formatPalette({ ...current, [token]: color.trim() }));
  }

  /** `<input type="color">` only takes #rrggbb. */
  function hex6(color: string): string {
    const c = color.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(c)) return c;
    if (/^#[0-9a-f]{3}$/.test(c)) return "#" + [...c.slice(1)].map((d) => d + d).join("");
    return "#000000";
  }

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
          <input
            id="set-baseurl"
            type="url"
            value={value("porridge:baseUrl")}
            oninput={set("porridge:baseUrl")}
            placeholder={remote.conn ? pagesUrl(remote.conn) : "https://you.github.io/blog/"}
            aria-describedby="set-baseurl-hint set-baseurl-problem"
          />
          <span id="set-baseurl-hint" class="field-hint">
            Leave empty to use {remote.conn ? "the repository's GitHub Pages address" : "your GitHub Pages address"}. Only needed for your own domain.
          </span>
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
        <fieldset class="nav-settings">
          <legend>Navigation</legend>
          <span class="field-hint">Shown at the top of every page, in this order, with search last. Add a page to it in the page's settings.</span>
          <ol class="nav-list">
            {#each nav as item, i (i)}
              <li class="nav-item">
                {#if item.kind === "link"}
                  <span class="nav-link-fields">
                    <input
                      id="nav-label-{i}"
                      value={item.label}
                      oninput={(e) => ws.updateNavLink(i, { label: e.currentTarget.value })}
                      placeholder="Label"
                      aria-label="Link {i + 1} label"
                    />
                    <input
                      type="url"
                      value={item.url}
                      oninput={(e) => ws.updateNavLink(i, { url: e.currentTarget.value })}
                      placeholder="https://…"
                      aria-label="Link {i + 1} address"
                      spellcheck="false"
                    />
                    {#if (item.label || item.url) && linkProblem(item.label, item.url)}
                      <span class="field-problem">{linkProblem(item.label, item.url)}</span>
                    {/if}
                  </span>
                {:else}
                  <span class="nav-name">{item.label}</span>
                  <span class="nav-kind">{item.kind === "page" ? "Page" : "Every post, by month"}</span>
                {/if}
                <span class="nav-buttons">
                  <button class="icon-button" onclick={() => ws.moveNav(i, -1)} disabled={i === 0} aria-label="Move {item.label || 'link'} up" title="Move up">↑</button>
                  <button class="icon-button" onclick={() => ws.moveNav(i, 1)} disabled={i === nav.length - 1} aria-label="Move {item.label || 'link'} down" title="Move down">↓</button>
                  {#if item.kind === "link"}
                    <button class="icon-button" onclick={() => ws.removeNavLink(i)} aria-label="Remove {item.label || 'link'}" title="Remove">×</button>
                  {/if}
                </span>
              </li>
            {/each}
          </ol>
          <div><button class="secondary" onclick={addLink}>Add a link</button></div>
        </fieldset>
        <fieldset class="colours">
          <legend>Colours</legend>
          <span class="field-hint">Each has a light and a dark version; readers see the one that matches their device.</span>
          <div class="theme-grid">
            {#each THEMES as t (t.name)}
              <label class="theme-card" class:chosen={themeName === t.name}>
                <input type="radio" name="theme" value={t.name} checked={themeName === t.name} onchange={() => chooseTheme(t.name)} />
                <span class="theme-sample" aria-hidden="true">
                  {#each [t.light, t.dark] as p, i (i)}
                    <span class="theme-half" style:background={p.bg} style:color={p.text} style:border-color={p.rule}>
                      Aa <span style:color={p.link}>link</span> <span style:color={p.muted}>·</span>
                    </span>
                  {/each}
                </span>
                <span class="theme-name">{t.label}</span>
                <span class="theme-desc">{t.description}</span>
              </label>
            {/each}
            <label class="theme-card" class:chosen={custom}>
              <input type="radio" name="theme" value="custom" checked={custom} onchange={() => chooseTheme("custom")} />
              <span class="theme-sample" aria-hidden="true">
                {#each [customLight, customDark] as p, i (i)}
                  <span class="theme-half" style:background={p.bg} style:color={p.text} style:border-color={p.rule}>
                    Aa <span style:color={p.link}>link</span> <span style:color={p.muted}>·</span>
                  </span>
                {/each}
              </span>
              <span class="theme-name">Custom</span>
              <span class="theme-desc">Your own colours</span>
            </label>
          </div>
          {#if custom}
            <div class="colour-table" role="group" aria-label="Custom colours">
              <span></span><span class="colour-head">Light</span><span class="colour-head">Dark</span>
              {#each COLOR_TOKENS as token (token)}
                <span class="colour-label">{COLOR_LABELS[token]}</span>
                {#each [["light", customLight], ["dark", customDark]] as const as [mode, p] (mode)}
                  <span class="colour-pick">
                    <input
                      type="color"
                      value={hex6(p[token])}
                      oninput={(e) => setColor(mode, token, e.currentTarget.value)}
                      aria-label="{COLOR_LABELS[token]}, {mode}"
                    />
                    <input
                      class="colour-text"
                      value={p[token]}
                      onchange={(e) => {
                        if (isSafeColor(e.currentTarget.value)) setColor(mode, token, e.currentTarget.value);
                        else e.currentTarget.value = p[token];
                      }}
                      spellcheck="false"
                      aria-label="{COLOR_LABELS[token]}, {mode}, as text"
                    />
                  </span>
                {/each}
              {/each}
            </div>
          {/if}
        </fieldset>
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
        <p>Connect a GitHub repository made from the Porridge template. The editor reads and writes it directly from this browser.</p>
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
