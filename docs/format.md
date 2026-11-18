# Porridge file format

Porridge content is plain [OPML 2.0](http://opml.org/spec2.opml). This document
defines the files, the head settings and the outline conventions the editor
writes and the builder reads.

**Status:** v1, finalised in milestone M1. Every rule here is exercised by the
sample content in [`template/`](../template) — see its README for the coverage
list.

## 1. Repository layout

```
blog.opml            blog settings + one include per year
blog/2026.opml       entries for 2026
blog/2025.opml       entries for 2025
pages/about.opml     a page
pages/books.opml     another page
images/2026/11/…     uploaded images
```

- Year files are created automatically by the editor the first time an entry
  is added in a new year.
- Any `.opml` file directly under `pages/` is a page. Its slug (URL) is the
  filename without `.opml`.

## 2. Common rules

- Encoding UTF-8. Every file is `<opml version="2.0">` with a `<head>` and a
  `<body>`.
- Porridge-specific elements and attributes live in the namespace
  `https://github.com/alexjj/porridge`, declared on the root element with the
  prefix `porridge`:
  `<opml version="2.0" xmlns:porridge="https://github.com/alexjj/porridge">`.
  Tools must match on the namespace URI, not the prefix.
- **Unknown attributes, head elements and namespaces are preserved** on save.
  Other tools, and future versions of Porridge, can add their own.
- `text` holds the node's content as **inline Markdown** (CommonMark: emphasis,
  strong, code, links, images, autolinks, and inline HTML). A node is a single
  line: line breaks in `text` are not meaningful — use another node.
- `created` is an RFC 822 date in GMT, e.g. `Wed, 18 Nov 2026 09:12:03 GMT`,
  set by the editor when a node is created and never changed afterwards.
- Head elements from the OPML spec that Porridge doesn't use (`expansionState`,
  `vertScrollState`, `dateModified`, …) are allowed and preserved. Porridge keeps
  collapse state in the browser, not in the files.

### Node attributes

| Attribute | Values | Meaning |
|---|---|---|
| `text` | Markdown | The node's content |
| `created` | RFC 822 date, GMT | Creation time; basis for entry anchors |
| `type` | see below | Structural role |
| `url` | relative path | Target of an `include`, relative to the including file |
| `date` | `YYYY-MM` or `YYYY-MM-DD` | The month or day a calendar node represents |
| `isDraft` | `true` | Kept in the file, skipped by the builder (with its children) |
| `isComment` | `true` | Kept in the file, never rendered (with its children) |

Boolean attributes are true only when the value is exactly `true`; absent or
any other value means false.

### Node types

| `type` | Used in | Meaning |
|---|---|---|
| `include` | `blog.opml` | Pulls in another OPML file (`url`) as this node's children |
| `calendarMonth` | year files | A month; requires `date="YYYY-MM"` |
| `calendarDay` | year files | A day; requires `date="YYYY-MM-DD"` |
| *(none)* | anywhere | Ordinary content |

## 3. `blog.opml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0" xmlns:porridge="https://github.com/alexjj/porridge">
  <head>
    <title>Alex's Daily</title>
    <description>Notes, mostly daily.</description>
    <ownerName>Alex</ownerName>
    <porridge:baseUrl>https://example.github.io/my-blog/</porridge:baseUrl>
    <porridge:timezone>Europe/London</porridge:timezone>
    <porridge:homeDays>10</porridge:homeDays>
    <porridge:rssItems>25</porridge:rssItems>
    <porridge:language>en-gb</porridge:language>
  </head>
  <body>
    <outline text="2026" type="include" url="blog/2026.opml"/>
    <outline text="2025" type="include" url="blog/2025.opml"/>
  </body>
</opml>
```

### Blog settings

| Element | Default | Meaning |
|---|---|---|
| `title` | *(required)* | Site title |
| `description` | empty | Site tagline, RSS description |
| `ownerName` | empty | Author name |
| `porridge:baseUrl` | the build's fallback | Absolute URL of the published site, ending in `/`. Optional when built by the GitHub Action, which passes the repository's Pages address as a fallback; the template's placeholder (`YOUR-USERNAME`/`YOUR-REPO`) counts as not set. Only needed for a custom domain |
| `porridge:timezone` | `UTC` | IANA timezone; decides what "today" is and anchor times |
| `porridge:homeDays` | `10` | Number of days shown in full on the home page |
| `porridge:rssItems` | `25` | Number of entries in the feed |
| `porridge:language` | `en` | `<html lang>` and RSS language |

The body contains only `include` nodes, one per year, **newest first**. Their
`text` is the year. The editor maintains this list.

## 4. Year files — `blog/YYYY.opml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0" xmlns:porridge="https://github.com/alexjj/porridge">
  <head>
    <title>2026</title>
  </head>
  <body>
    <outline text="November 2026" type="calendarMonth" date="2026-11">
      <outline text="18th November" type="calendarDay" date="2026-11-18">
        <outline text="Post with a title" created="Wed, 18 Nov 2026 17:40:10 GMT">
          <outline text="First paragraph, with a [link](https://example.com)."/>
          <outline text="![A bowl of porridge](/images/2026/11/porridge.jpg)"/>
        </outline>
        <outline text="A one-paragraph post. No title, still linkable." created="Wed, 18 Nov 2026 09:12:03 GMT"/>
      </outline>
    </outline>
  </body>
</opml>
```

### Structure rules

- Body children are `calendarMonth` nodes; their children are `calendarDay`
  nodes; their children are **entries**.
- **Newest first at every level**: latest month at the top, latest day at the
  top of its month, latest entry at the top of its day.
- The **`date` attribute is authoritative**. `text` is a display label the
  editor generates (`November 2026`, `18th November` — month name and English
  ordinal day: 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 22nd, 23rd … 31st).
  The builder never parses `text` to find a date.
- A day belongs to the year file of its `date`. The editor decides which day an
  entry goes in using the blog's timezone, so an entry created at
  `23:20 GMT` on 15 July is filed under 16th July for a blog in
  `Europe/London` (00:20 BST).
- A day with no publishable entries (all drafts, comments, or empty) is not
  published. Likewise a month with no published days.
- Nodes at month or day level that aren't the right calendar type are a format
  error; the builder warns and skips them.

### Entries

- **No children →** a single untitled paragraph. Rendered as a paragraph with a
  `#` permalink in the left margin.
- **Has children →** `text` is the entry's **title**, rendered as a heading
  that links to the entry's permalink, with the same `#` in the margin; the
  children are its body.
- Body children render as paragraphs. A body node that itself has children
  renders as a paragraph followed by a nested list of its children,
  recursively.
- `isDraft` and `isComment` remove the node and everything beneath it, at any
  level (entry or body node). An entry whose children are all removed renders
  as a heading with no body.

### Anchors and permalinks

- Each entry's anchor is `a` followed by its `created` time **in the blog's
  timezone** as `HHMMSS`, e.g. `#a174010`.
- The permalink is the day page plus the anchor:
  `https://example.github.io/my-blog/2026/11/18/#a174010`.
- The editor guarantees `created` is unique within a day (bumping by one second
  if needed), so anchors never collide and don't change when the entry is
  edited or moved within the day.
- **Fallback for hand-written entries with no `created`:** the anchor is `n`
  followed by the entry's 1-based position counting from the **oldest** (bottom)
  entry of the day, e.g. `#n1`. Counting from the bottom keeps existing anchors
  stable when newer entries are added above.
- Anchors are assigned over **all** entries of the day, drafts and comments
  included, so publishing a draft never changes another entry's anchor. If two entries produce the same
  anchor, the builder appends `-2`, `-3`, … in document order and warns.

### RSS

- One `<item>` per published entry, newest first, up to `porridge:rssItems`.
- Titled entries have a `<title>`; untitled entries have none (valid RSS 2.0).
- `<description>` is the entry's rendered HTML.
- `<link>` and `<guid isPermaLink="true">` are the permalink.
- `<pubDate>` is `created`; entries without `created` use the day's date at
  00:00 in the blog's timezone.

## 5. Pages — `pages/<slug>.opml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0" xmlns:porridge="https://github.com/alexjj/porridge">
  <head>
    <title>About</title>
    <porridge:inNav>true</porridge:inNav>
    <porridge:navOrder>1</porridge:navOrder>
  </head>
  <body>
    <outline text="Hello, I'm Alex."/>
    <outline text="Elsewhere">
      <outline text="[Mastodon](https://example.social/@alex)"/>
    </outline>
  </body>
</opml>
```

### Page settings

| Element | Default | Meaning |
|---|---|---|
| `title` | slug | Page title and default nav label |
| `porridge:inNav` | `false` | Show in the site navigation |
| `porridge:navOrder` | `100` | Sort order in the navigation (ascending, then by label) |
| `porridge:navLabel` | `title` | Override the nav label |
| `porridge:isDraft` | `false` | Don't publish this page at all |

Published at `/<slug>/`.

### Slugs

- Lowercase letters, digits and hyphens, starting with a letter:
  `^[a-z][a-z0-9-]*$`. (Starting with a letter keeps pages clear of the
  `/2026/` year URLs.)
- Reserved, can't be used: `images`, `rss`, `index`, `assets`, `archive`,
  `search`, `pagefind`.

### Rendering rules

- Top-level node **without** children → paragraph.
- Top-level node **with** children → `<h2>` section heading, children render
  inside it.
- Second level with children → `<h3>`; third level with children → `<h4>`.
- Below that, a node with children renders as a paragraph followed by a nested
  list (the same rule as entry bodies).
- `isDraft` / `isComment` nodes are skipped with their children.

## 6. Images

- Uploaded via the editor to `images/YYYY/MM/<name>.<ext>`: resized in the
  browser to at most 2000px on the long side and encoded as WebP (JPEG in
  browsers that can't make WebP). A small JPEG, PNG or WebP is kept as it is
  when the WebP wouldn't be smaller; GIFs and SVGs are always kept as they are.
- Referenced with root-relative Markdown: `![alt](/images/2026/11/cat.jpg)`.
- The builder rewrites root-relative URLs (those starting with a single `/`)
  in Markdown links and images against `porridge:baseUrl`, so a site served
  from a sub-path such as `https://example.github.io/my-blog/` works. Pages
  use the base URL's path (`/my-blog/images/…`); RSS uses the full URL. URLs
  in inline HTML are left as written.
- Everything under `images/` is copied to the site verbatim.
- An image's description (`![this text](…)`) is shown as a caption, centred
  underneath it. Images with no description have no caption.
- On the site, clicking an image (or pressing Enter on it) opens it full size
  in a lightbox, with its caption. Images that are links keep their link.

## 7. Errors and warnings

The builder is forgiving: it publishes what it can and reports problems.

| Problem | Behaviour |
|---|---|
| File isn't well-formed XML | **Error**, build fails |
| `include` target missing | **Error**, build fails |
| Missing `title`, or no `porridge:baseUrl` and no fallback address | **Error**, build fails |
| `porridge:baseUrl` is the template's placeholder and there's no fallback | Warning |
| Calendar node missing or malformed `date` | Warning, node skipped |
| Wrong node type at month/day level | Warning, node skipped |
| Invalid or reserved page slug | Warning, page skipped |
| Duplicate anchor in a day | Warning, suffix added |
| Unparseable `created` | Warning, treated as missing |
