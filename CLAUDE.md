# CLAUDE.md

Notes for anyone (human or Claude) working on Porridge. Read this first, then
`docs/format.md` (the file format, the source of truth for what the builder
and editor must agree on) and `docs/PLAN.md` (what's built, what's next, and
decisions already made).

## What Porridge is

An outliner for writing a daily blog, in the spirit of Drummer and Dynalist.

- A blog is a **GitHub repo of OPML files**: `blog.opml` (settings + one
  include per year), `blog/YYYY.opml` (months → days → posts, newest first),
  `pages/*.opml`, and `images/`. Starter: `template/`, which is synced to
  `alexjj/porridge-blog-template` (the "Use this template" repo).
- The **editor** is a static web app (published from `main` to this repo's
  GitHub Pages). It talks to the GitHub API straight from the browser with the
  user's fine-grained token. There is no server, anywhere.
- The **builder** turns a blog repo into a static site. Blogs run it through
  this repo's GitHub Action (`action.yml`), with **`uses: alexjj/porridge@main`**.

**`main` is live.** Every user's blog builds with whatever is on `main` the
next time they publish, and the editor redeploys from `main`. Keep `main`
green: CI must pass before anything lands there.

## Layout

```
packages/core     OPML model, site loader, Markdown, HTML/RSS renderers, theme
                  (used by both the builder and the editor's live preview)
packages/build    `porridge build` CLI (Node), bundled to dist/porridge.mjs
packages/editor   Svelte 5 + Vite app
  src/model       pure outline logic: tree, ops (indent/move/split/selection
                  blocks), calendar (New entry), images (sizing/naming rules)
  src/github      GitHub REST client (api.ts) and sync logic (sync.ts)
  src/store       app state: workspace.svelte.ts (files, undo, autosave),
                  remote.svelte.ts (connect/save/publish), keys, commands,
                  photos (resize/WebP), preview, IndexedDB (persist.ts)
  src/ui          components; App.svelte wires everything together
  test            Vitest unit tests + fake-github.ts (in-memory GitHub API)
  e2e             Playwright tests; e2e/starter is the fixed test blog
action.yml        the GitHub Action blogs use: runs dist/porridge.mjs, then Pagefind
dist/porridge.mjs committed build of the CLI (the Action runs this file)
template/         starter blog for new users (also the editor's first-visit content)
fixtures/         sample-blog (exercises every rule in format.md), errors/, and
                  expected/ (golden output of building sample-blog)
docs/             PLAN.md, format.md
```

## Commands

```bash
npm install
npm run dev          # editor at http://localhost:5173 (work is kept in that browser)
npm test             # Vitest: core, build, editor model/sync
npm run typecheck    # tsc for core/build + svelte-check for the editor
npm run e2e          # Playwright (Chromium); builds the editor itself
npm run bundle       # rebuild dist/porridge.mjs — commit it whenever core/build change
npm run sample       # build fixtures/sample-blog into out/sample (+ Pagefind)
npm test -- -u       # refresh golden files after an intended output change; review the diff
```

Preview the built sample with `python3 -m http.server 8080 -d out/sample`.

Before pushing, run **typecheck, test, e2e and bundle**. CI fails if
`dist/porridge.mjs` is stale.

## Rules that are easy to break

**Format and output**
- `docs/format.md` is the contract. Change the spec, the fixtures, the code
  and the golden files together.
- OPML must **round-trip byte for byte** (`parseOpml` → `serializeOpml`), and
  editor files the same (`fileFromOpml` → `fileToOpml`). Unknown attributes and
  head elements are preserved. There are tests; keep them passing.
- `created` (RFC 822, GMT) is the basis of each post's permalink anchor
  (`#aHHMMSS` in the blog's timezone). Never change an existing `created`.
- Calendar nodes are identified by their `date` attribute, never their text.
- Builder output is deterministic (no timestamps). Golden files live in
  `fixtures/expected/`; update with `npm test -- -u` and read the diff.
- Root-relative URLs in Markdown (`/images/…`, `/about/`) are rewritten by
  `createInlineRenderer`: site base path in HTML, full URL in RSS, the repo's
  raw URL for images in the editor.
- Reserved page names: see `RESERVED_SLUGS` in `core/src/site.ts`.
- The site address (`porridge:baseUrl`) is optional: the Action passes the
  repo's Pages address as `fallback-base-url`, and the template's placeholder
  counts as unset. The editor does the same with `pagesUrl(conn)`.

**Editor (Svelte 5)**
- State lives in classes with runes (`$state`, `$derived`) in `*.svelte.ts`.
  Values going to IndexedDB must be plain: use `$state.snapshot(...)`
  (proxies can't be cloned).
- Focus: `ws.focusNode(id, caret)` sets `editingId`, calls `flushSync()`, then
  focuses `#ta-<id>`. Moving a node rebuilds its textarea and the old one fires
  blur, so blur handlers check `document.activeElement` on a timeout before
  clearing `editingId`.
- An open `<dialog>` (modal) makes the rest of the page inert: **close the
  dialog before** inserting text or focusing a line.
- Every content change goes through `ws.op(...)`, `ws.setText(...)`,
  `ws.blockOp(...)` or another Workspace method that records an undo snapshot
  and marks files dirty. Don't mutate nodes directly from components.
- Calendar nodes (`type="calendarMonth|calendarDay|include"`) are "locked":
  not editable, not movable, not selectable. Ops return null/false for them.
- Menu actions close the menu first, so capture the node (and the cursor
  range) before closing. See `NodeMenu.svelte`.
- New UI text: plain and short, British spelling, no jargon ("Save" keeps it
  on GitHub, "Publish" rebuilds the site).
- Buttons that hide their text on small screens need an `aria-label`.

**GitHub sync** (`src/github/sync.ts`)
- The "base" is the last synced commit plus each content file's text. Local
  vs base = changed here; base sha vs remote sha = changed on GitHub; both =
  conflict (the user picks; history is never force-pushed).
- Base texts are normalised through the editor's own serializer, so files
  hand-formatted on GitHub don't look locally changed.
- Save commits with `[skip ci]` (no build); Publish commits without it, or
  dispatches the workflow when there's nothing to commit, then polls the run.

## Tests

- **Unit (Vitest):** `packages/*/test`. The fake GitHub
  (`packages/editor/test/fake-github.ts`) implements the REST calls the editor
  uses, with real git-style blob shas. Use it rather than mocking `fetch`.
- **Browser (Playwright):** `packages/editor/e2e`.
  - The `chromium` project runs against an editor built with `--mode e2e`,
    whose starter is the small fixed blog in `e2e/starter/` (so content
    changes in `template/` don't break tests).
  - The `starter` project runs `starter.spec.ts` against a normal build, to
    check the real starter (images, upload to an empty repo).
  - GitHub is faked with `page.route` → `FakeGitHub` (`e2e/github-helpers.ts`).
  - The published site is tested in `site.spec.ts` by building the sample
    blog and serving it through `page.route`.
  - `phone.spec.ts` emulates a Pixel 7 (touch, small screen).
  - Pin the clock with `openEditor(page, time)`; default is 2026-11-18 19:30 UTC.
- Chromium only. Real iOS Safari / Android Chrome need checking by hand,
  especially the toolbar above the on-screen keyboard.

## Versions and dependencies

- TypeScript is pinned to **5.9** (svelte-check doesn't support TS 7).
- Pagefind is pinned to **1.6.0** in `action.yml` and `package.json`.
- Pin exact versions (`--save-exact`); prefer releases at least two weeks old.
- Keep dependencies minimal. The site ships one stylesheet and one tiny
  script (`porridge.js`, the lightbox); keep it dependency-free ES5.

## Workflow

- Work on a branch; open a PR into `main`; CI (`.github/workflows/ci.yml`)
  runs typecheck, unit tests, the bundle check, e2e, and a real run of the
  Action against `template/`.
- Changing `template/` on `main` triggers `sync-template.yml`, which copies it
  to `alexjj/porridge-blog-template` (needs the `TEMPLATE_REPO_TOKEN` secret).
- Update `docs/PLAN.md` when something ships or a decision is made, and
  `docs/format.md` when the format or rendering rules change.
