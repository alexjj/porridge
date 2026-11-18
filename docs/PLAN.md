# Porridge — build plan

Porridge is an outliner-based daily blogging platform in the spirit of
[Drummer](https://docserver.scripting.com/drummer/about.opml), with a
Dynalist-style editing interface. Everything is an outline, everything is
stored as OPML in a git repo, and nothing needs a server you run yourself.

This document covers architecture, decisions made so far, and the order we'll
build things in. The file format itself is specified in [format.md](format.md).

---

## 1. Goals

- **Static everything.** Content is OPML files in a git repo (GitHub). The
  published blog is static HTML.
- **No self-hosting.** The editor is a static web app (Cloudflare Pages or
  GitHub Pages) that talks directly to the GitHub API. The site is built by
  GitHub Actions and served by GitHub Pages (or Cloudflare Pages).
- **Outliner first.** Every document is an outline. Indent, outdent, move up and
  down, collapse, zoom.
- **Good on a phone.** Mobile is a first-class target, not an afterthought.
- **Simple, readable output.** Posts shown in full, newest first, in the style
  of [daily.baty.net](https://daily.baty.net/).

## 2. Decisions

| Topic | Decision |
|---|---|
| Storage format | OPML 2.0, entry text is inline Markdown |
| Blog structure | Year → Month → Day → Entry, **newest first** at every level |
| File split | `blog.opml` holds settings + includes; posts live in **one file per year**, `blog/2026.opml`, created automatically |
| Settings | Stored in each file's `<head>` (namespaced `porridge:` elements), edited via the settings menu |
| Entry rule | No children → single untitled paragraph. Has children → text is the title, children are the body |
| Permalinks | Anchor derived from the entry's `created` timestamp, on the **day page**. No per-post pages |
| Saving | **Save** commits to the repo without building. **Publish** saves and builds |
| Auth (phase 1) | Fine-grained GitHub personal access token, stored in the browser |
| Auth (later) | GitHub App sign-in via a small Cloudflare Worker for the token exchange |
| Deploy target | GitHub Pages by default |

## 3. Architecture

```
porridge (this repo — the app)              my-blog (content repo, one per user)
├─ packages/core    OPML ⇄ tree model,      ├─ blog.opml          settings + year includes
│                   calendar logic,          ├─ blog/2026.opml     posts for 2026
│                   Markdown, HTML render    ├─ blog/2025.opml
├─ packages/editor  static web app           ├─ pages/about.opml   other pages
├─ packages/build   CLI used by the Action   ├─ images/2026/11/…
├─ action.yml       reusable GitHub Action   └─ .github/workflows/build.yml
├─ template/        starter content repo          (uses: alexjj/porridge@v1)
└─ fixtures/        test content covering
                    every rule in format.md
```

### 3.1 `packages/core` (shared by editor and builder)

The single source of truth for how OPML is read, edited and rendered. Because
the editor's live preview and the published site use the same code, preview and
output can't drift apart.

- OPML parse / serialize, preserving unknown attributes and head elements
  (round-trip safe: load → save with no edits keeps every element, attribute
  and their order; a file porridge has saved once comes back byte-identical).
- Tree model with operations: insert, delete, split, merge, indent, outdent,
  move up/down, all expressed as reversible operations (powers undo/redo).
- Calendar helpers: find or create year file / month / day for a given date in
  the blog's timezone; keep newest-first ordering.
- Include resolution: `blog.opml` + `blog/*.opml` → one logical blog.
- Markdown rendering for entry text (markdown-it, inline subset + images).
- HTML renderers: day, month archive, home, page, RSS.
- Anchor/permalink generation.

### 3.2 `packages/build` + GitHub Action

- A Node CLI: `porridge build <content-dir> <out-dir>`.
- Published as a composite GitHub Action at the root of this repo
  (`action.yml`, input `output`, default `_site`), so a content repo's
  workflow is short: see
  [`template/.github/workflows/build.yml`](../template/.github/workflows/build.yml).

- Commits whose message contains `[skip ci]` don't trigger it (that's how Save
  avoids a build — see §5).

**Site output:**

| URL | Content |
|---|---|
| `/` | Latest *N* days (setting `homeDays`, default 10), all entries in full, link to older |
| `/2026/11/18/` | Day page — every entry with its anchor; this is the permalink target |
| `/2026/11/` | Month archive — all days in the month, in full |
| `/2026/` | Year index — list of months/days |
| `/archive/` | Every year, month and day; linked from the navigation |
| `/about/` etc. | One page per file in `pages/` |
| `/rss.xml` | RSS 2.0 feed of the most recent entries, each linking to its anchor |
| `/404.html` | Not-found page (GitHub Pages serves it automatically) |
| `/images/…` | Copied verbatim |

Theme: one plain HTML template + one CSS file, readable typography, light/dark.
Overridable themes come later.

### 3.3 `packages/editor`

Static single-page app: TypeScript + Vite + Svelte 5. No backend.

**Layout (desktop):**

```
┌──────────────────────────────────────────────────────────────┐
│ porridge          ● unsaved    [Save] [Publish]   ⚙          │  thin top bar
├────────────┬──────────────────────────────────┬──────────────┤
│ blog       │ ▾ November 2026                  │ Syntax help  │
│ ▸ 2026     │   ▾ 18th November                │ **bold**     │
│ ▸ 2025     │     • A one-paragraph post…      │ [link](url)  │
│ pages      │     • Post with a title          │ ![img](url)  │
│   about    │         • First paragraph…       │ Shortcuts…   │
│   books    │ (+)                              │              │
│ [+ page]   │                                  │              │
└────────────┴──────────────────────────────────┴──────────────┘
```

**Layout (mobile):** single column showing the outline. The file list and help
panel slide in as drawers. A toolbar is pinned above the on-screen keyboard
with **indent, outdent, move up, move down, +, and bullet menu** — mobile has
no Tab key, so this toolbar is what makes outlining work on a phone.

**Outliner behaviour:**

- The tree model lives in memory; each node is rendered as its own small text
  field. (Not one big `contenteditable` — that's where outliners usually fall
  apart, especially on mobile.)
- Like Dynalist, the focused node shows raw Markdown; other nodes show
  rendered text.
- Keys: Enter splits, Backspace at start merges with previous, Tab /
  Shift-Tab indent/outdent, Alt-Shift-↑/↓ move, Ctrl/Cmd-↑/↓ collapse/expand,
  Ctrl/Cmd-Z / Shift-Z undo/redo, Esc leaves edit mode.
- **Zoom:** click/tap a bullet's zoom action to show only that node's subtree,
  with a breadcrumb back out.
- **Bullet menu** (tap a bullet): add link, add image, zoom, copy permalink,
  mark as draft, mark as comment, collapse/expand, delete.
- **+ button:** ensures today's year file, month and day nodes exist (in the
  blog's timezone), adds a new entry at the top of today, focuses it.
- Collapse state is stored in the browser, not in the repo, to avoid noisy
  commits.

**File list:** `blog` (with years as children, lazily loaded), then `pages`.
"+ page" creates `pages/<slug>.opml` with default head settings.

**Settings menu (⚙):** repo connection (owner/repo/branch/token), blog settings
(the `blog.opml` head), and per-page settings (that page's head: title, show in
nav, nav order).

## 4. GitHub access

- **Phase 1:** user creates a fine-grained personal access token limited to
  their blog repo with permissions **Contents: read/write**, **Actions:
  read/write** (to trigger and watch builds), **Metadata: read**. Pasted into
  settings, stored in browser storage.
- **Reading:** files are fetched as raw content (handles large files beyond the
  1 MB limit of the JSON contents API). Year files are fetched on demand.
- **Writing:** all changed files and new images go up as a **single commit**
  via the Git Data API (create blobs → create tree → create commit → update
  ref). The update is conditional on the branch still pointing at the commit we
  loaded from.
- **Later (multi-user / hosted):** a GitHub App with "Sign in with GitHub" and
  a repo picker. Browsers can't do the OAuth code exchange (it needs the client
  secret), so a small Cloudflare Worker does that one step. Everything else is
  unchanged. Paired with a template repo, onboarding becomes: Use this template
  → enable Pages → sign in to the editor.

## 5. Save, Publish and local drafts

There are three layers of "saved":

1. **Local autosave (continuous).** Every change is written to the browser's
   IndexedDB immediately. Closing the tab, losing signal or a crash loses
   nothing. The top bar shows `● unsaved` when local differs from the repo.
2. **Save.** Commits all changed files to `main` with `[skip ci]` in the
   message. Content is safe in git and available on other devices; the site is
   **not** rebuilt.
3. **Save & Publish.** If there are changes, commits them *without*
   `[skip ci]`, which triggers the build. If everything is already saved,
   triggers the workflow directly (`workflow_dispatch`). The top bar then shows
   the build's progress and result via the Actions API.

Because Publish builds whatever is in `main`, anything saved earlier goes live
too. To keep a half-written entry back, mark it as a **draft** (bullet menu →
`isDraft="true"`): drafts are kept in the OPML but skipped by the builder.

**Conflicts (two devices).** Commits are conditional on the branch head we
loaded from. If the remote has moved, phase 1 stops and offers to reload (your
local copy stays in IndexedDB so nothing is lost). A proper three-way merge of
outlines is a later improvement.

## 6. Milestones

Each milestone ends with something usable.

### M1 — Format spec and sample content ✅
- [x] `docs/format.md` finalised (v1).
- [x] `template/`: clean starter content repo — `blog.opml`,
      `blog/2026.opml`, `pages/about.opml`, workflow file, setup README.
- [x] `fixtures/sample-blog/`: covers every rule in the spec, including
      warning cases, with a rule → location table in `fixtures/README.md`.
- [x] `fixtures/errors/`: one small repo per build-failing error.
- **Done when:** the sample files cover every rule in the spec.

### M2 — Core library and builder ✅
- [x] npm workspaces monorepo, TypeScript, Vitest.
- [x] OPML parse/serialize with round-trip tests.
- [x] Include resolution, calendar model, draft/comment filtering.
- [x] Renderers: home, day, month, year, archive, page, RSS, 404; base theme.
- [x] `porridge build` CLI and `action.yml` (runs the committed bundle
      `dist/porridge.mjs`, so blogs need no `npm install`).
- [x] Golden-file tests: `fixtures/sample-blog` → `fixtures/expected/`, and
      exact warnings; each `fixtures/errors/*` fails with the right error.
- [x] Round-trip test: every fixture and template file comes back
      byte-identical.
- [x] CI: typecheck, tests, `dist/` freshness check, and a run of the action
      itself against `template/`.
- [ ] Tag `v1` so `uses: alexjj/porridge@v1` resolves (after merging to main).
- **Done when:** a content repo built from `template/` publishes a working
  blog to GitHub Pages on push, from hand-edited OPML.

### M3 — Desktop outliner (local only) ✅
- [x] Three-panel layout and top bar (Svelte 5 + Vite, `packages/editor`).
- [x] Outline editing: Enter/split, Backspace/Delete join, Tab/Shift-Tab,
      move up/down, delete, arrow navigation, collapse, zoom with breadcrumbs,
      bold/italic, multi-line paste, undo/redo (snapshot based, typing
      coalesced per line).
- [x] Rendered/raw Markdown switching.
- [x] New entry button: today in the blog's timezone, creating the day, month,
      year file and include as needed; every entry gets a unique `created`.
- [x] IndexedDB autosave (after a pause, at least every 2s while typing);
      collapse state remembered per browser; open a blog folder; download a
      file or everything as a zip; reset to the starter blog.
- [x] Live preview of the day or page being edited, using `core`.
- [x] Playwright tests for the keyboard operations, persistence, preview,
      and a week of posts across a year boundary exported as valid OPML.
- **Done when:** you can write a week of posts in the browser and export valid
  OPML.

Deferred from M3:
- The zoomed-in node's title is display-only; zoom out to edit it.
- Calendar headings (months, days) can't be deleted or moved from the editor.
- `blog.opml` itself isn't shown; its settings get a settings screen in M4.
- Images referenced with `/images/…` don't display in the editor or preview
  until the editor can read them from the repo (M4).

### M4 — GitHub connection
- [ ] Settings: repo + token, connection check.
- [ ] File list loaded from the repo; lazy year loading.
- [ ] Save (single commit, `[skip ci]`) and Save & Publish (commit or
      `workflow_dispatch`), build status in the top bar.
- [ ] Create / rename / delete pages; page settings (nav).
- [ ] Conflict detection and reload.
- **Done when:** you can write and publish daily from the hosted editor on a
  laptop with no local tooling.

### M5 — Mobile and element menus
- [ ] Responsive layout, drawers, keyboard-pinned toolbar.
- [ ] Bullet menu: link, image, permalink, draft, comment, delete.
- [ ] Image upload: resize in the browser, stage in IndexedDB, commit under
      `images/YYYY/MM/` on Save.
- [ ] Touch testing on iOS Safari and Android Chrome.
- **Done when:** posting with a photo from a phone is comfortable.

### M6 — Opening it up
- [ ] GitHub App + Cloudflare Worker sign-in, repo picker.
- [ ] Template repo published; setup guide.
- [ ] Theme overrides.

## 7. Later ideas (not scheduled)

- Search across all years in the editor.
- Three-way outline merge for multi-device conflicts.
- Cloudflare Pages deploy option.
- Incremental builds (only the changed year/days).
- Webmentions / comments, micro.blog cross-posting, rssCloud ping.
- Glossary / macros (Drummer-style).
- Import from Drummer OPML.
