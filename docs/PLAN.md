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
├─ template/        starter content repo          (uses: alexjj/porridge@main)
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
| `/search/` | Search, linked by a magnifier icon at the end of the navigation. Uses [Pagefind](https://pagefind.app/): the action indexes day pages and pages after the build (`search: false` turns it off) |
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
- **Reading:** the branch head's tree is listed, and changed content files are
  fetched as raw blobs (no 1 MB limit).
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
- [x] Blogs use `alexjj/porridge@main`, so builder changes reach them on the
      next publish (the `v1` tag still exists for anyone pinned to it).
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

### M4 — GitHub connection ✅
- [x] Settings: repository, branch, build workflow and token; checks access
      before connecting. Connecting loads the repo's blog, or uploads the
      browser's blog to a repo that has none.
- [x] All content files load from the repo (see deviation below), and changes
      made on GitHub are brought in on startup and on every save.
- [x] Save: one commit with `[skip ci]`. Save & Publish: a normal commit, or a
      `workflow_dispatch` when there's nothing to save; the build is followed
      in the top bar and links to the site or the failed run. Ctrl/⌘-S saves.
- [x] Pages: create, settings (title, navigation, order, label, draft),
      rename, delete. Blog settings screen for `blog.opml`.
- [x] Conflicts: a file changed both here and on GitHub asks which version to
      keep; either way history is kept (no force pushes). Changes to other
      files merge automatically, including a push that lands mid-save.
- [x] Images under `/images/` show in the editor and preview, loaded from the
      repo (public repositories).
- [x] The editor is published to this repo's GitHub Pages
      (`.github/workflows/editor.yml`).
- [x] Tests: sync logic against an in-memory fake of the GitHub API; the same
      fake drives Playwright tests of connecting, saving, publishing,
      conflicts, pages and settings.
- **Done when:** you can write and publish daily from the hosted editor on a
  laptop with no local tooling.

Deviations from the plan:
- **Year files load eagerly, not lazily.** Each is one small request, the
  preview needs them all, and unchanged files come from the browser's copy.
  Lazy loading can come back if a blog ever gets big enough to need it.
- GitHub's `permissions` check only shows the token's *user* can push; a
  fine-grained token missing Contents write is reported when saving.
- Images in private repositories don't display in the editor yet.

### M5 — Mobile and element menus ✅
- [x] Responsive layout and drawers (from M3), tighter indentation and
      bigger touch targets on phones.
- [x] Editing toolbar pinned above the on-screen keyboard (follows the visual
      viewport on iOS; `interactive-widget=resizes-content` on Android):
      outdent, indent, move, undo, link, image, line menu, done. Fits a
      360px-wide screen.
- [x] Line menu from each bullet (a bottom sheet on phones): zoom, add link,
      add image, copy link (the entry's permalink), draft, comment,
      collapse, delete — including day and month headings. Ctrl/⌘-K adds a
      link while typing.
- [x] Images: picked from the camera or library, resized in the browser
      (long edge 2000px, JPEG; small web images and GIFs kept as they are),
      kept in IndexedDB and shown straight away, then uploaded in the same
      commit as the text on Save or Publish. Included in "Download all".
- [x] Tests: Playwright with phone emulation (touch, Pixel 7) for posting a
      photo end to end against the fake GitHub, the bottom sheet, the
      toolbar and sideways scrolling; desktop tests for the menu and images.
- **Done when:** posting with a photo from a phone is comfortable.

Still to check by hand: real iOS Safari and Android Chrome. The automated
tests emulate a phone in Chromium; they can't show how the on-screen keyboard
and the toolbar behave on real devices.

Deferred:
- Images in private repositories still don't display in the editor.

### Since M5
- [x] The zoomed-in line's title is editable (Enter starts its first child).
- [x] Several lines can be selected (drag, Shift-click, Shift-↑/↓ at a line's
      edge, or "Select…" in the line menu on touch screens) and indented,
      moved or deleted together. Selections widen to whole sibling lines.
- [x] Site search with Pagefind; `#` permalinks in the margin.
- [x] The site address is optional: blogs built by the Action fall back to
      the repository's Pages address (`actions/configure-pages`), so the
      template has no placeholder and its own Pages site renders properly.

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
