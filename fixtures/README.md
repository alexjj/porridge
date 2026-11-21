# Fixtures

Test content for the builder and core library (milestone M2 onwards). These
are **not** starter content — see [`template/`](../template) for that.

## `sample-blog/`

A full content repo that exercises every rule in
[docs/format.md](../docs/format.md), including the ones that produce
warnings. The builder must build it successfully; its output becomes the
golden files for the renderer tests.

| Rule (format.md) | Where |
|---|---|
| §2 Namespaced settings, `porridge` prefix | every file |
| §2 Unknown attributes and namespaces preserved | `blog/2025.opml` — 1st December (`myTool:rating`, `customFlag`) |
| §2 Unused OPML head elements preserved | `blog/2026.opml` — `expansionState` |
| §2 Inline Markdown: strong, emphasis, code, links, images | `blog/2026.opml` — 18th & 17th November |
| §2 Inline HTML and autolinks | `blog/2026.opml` — "Starting porridge" |
| §3 All blog settings | `blog.opml` |
| §3 Year includes, newest first | `blog.opml` (2026, 2025) |
| §4 Newest first at every level | `blog/2026.opml` |
| §4 `date` is authoritative; label formats and ordinals | all calendar nodes (1st, 2nd, 3rd, 12th, 15th, 16th, 17th, 18th, 31st) |
| §4 Timezone decides the day | `blog/2026.opml` — 15th & 16th July (BST) |
| §4 Day with only drafts not published | `blog/2026.opml` — 12th October |
| §4 Month with nothing publishable not published | `blog/2026.opml` — September 2026 |
| §4 Entry without children (untitled, `#` permalink) | `blog/2026.opml` — 18th November 09:12 |
| §4 Entry with children (titled) | `blog/2026.opml` — "Starting porridge" |
| §4 Body node with children → paragraph + nested paragraphs | "Starting porridge" — "Inline HTML is allowed" |
| §4 Body node with `list="bullets"` → paragraph + nested list | "Starting porridge" — ingredients |
| §4 `isDraft` on an entry | 18th November 21:05 |
| §4 `list="bullets"` on a titled entry | 17th November 07:30 |
| §4 `isComment` on a body node and a list item | "Starting porridge" |
| §4 Titled entry with all children removed | 31st October |
| §4 Anchor from `created` in the blog's timezone | all entries; claimed anchors are checked |
| §4 Fallback `n` anchors, counted from the bottom | `blog/2025.opml` — 31st December |
| §4 Duplicate anchors get `-2` (warning) | `blog/2025.opml` — 15th June |
| §4 Unparseable `created` (warning) | `blog/2025.opml` — 15th June |
| §4 Calendar node without `date` (warning) | `blog/2025.opml` — "Some day in December" |
| §4 Non-calendar node at month level (warning) | `blog/2025.opml` — last node |
| §5 Page in nav with `navOrder` | `pages/about.opml` |
| §5 `list="bullets"` on a page section | `pages/books.opml` |
| §5 `navLabel` override | `pages/now.opml` |
| §5 Page not in nav | `pages/books.opml` |
| §5 Draft page (`porridge:isDraft`) | `pages/ideas.opml` |
| §5 Invalid slug (warning) | `pages/Bad_Slug.opml` |
| §5 Reserved slug (warning) | `pages/rss.opml` |
| §5 Page rendering: p, h2, h3, h4, lists, draft, comment | `pages/about.opml` |
| §6 Root-relative image and link rewriting | `blog/2026.opml` — "Starting porridge"; `pages/now.opml` |
| §6 Images copied verbatim | `images/2026/11/porridge.jpg` |

Not covered here: the editor's guarantee that `created` is unique within a
day (§4). That's an editor rule, so it's tested in M3.

## `errors/`

Each folder is a small content repo that must make the build **fail** (§7):

| Folder | Error |
|---|---|
| `malformed-xml/` | `blog/2026.opml` isn't well-formed XML |
| `missing-include/` | `blog.opml` includes `blog/2025.opml`, which doesn't exist |
| `missing-settings/` | `blog.opml` has no `title` or `porridge:baseUrl` |
