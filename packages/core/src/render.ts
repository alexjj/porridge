// Renders a loaded Site to static files. Output is deterministic (no build
// timestamps), so the same content always produces the same files.

import { formatRfc822, longDayLabel, monthLabel, zonedMidnight } from "./dates.js";
import { createInlineRenderer, type InlineRenderer } from "./markdown.js";
import { attr, publishedChildren, type Outline } from "./opml.js";
import type { Day, Entry, Page, Site } from "./site.js";
import { SCRIPT, STYLESHEET } from "./theme.js";

export interface OutputFile {
  /** Path within the output directory, using `/`. */
  path: string;
  content: string;
}

interface Ctx {
  site: Site;
  /** Inline renderer for pages (root-relative URLs → base path). */
  md: InlineRenderer;
  /** Inline renderer for RSS (root-relative URLs → absolute). */
  mdAbs: InlineRenderer;
  /** Prefix for links within the site. */
  base: string;
}

export function renderSite(site: Site): OutputFile[] {
  const ctx: Ctx = {
    site,
    md: createInlineRenderer(site.settings.basePath),
    mdAbs: createInlineRenderer(site.settings.baseUrl),
    base: site.settings.basePath,
  };
  const files: OutputFile[] = [];
  const add = (path: string, content: string) => files.push({ path, content });

  add("index.html", renderHome(ctx));
  site.days.forEach((day, i) => add(`${dayPath(day.date)}index.html`, renderDayPage(ctx, i)));

  const months = unique(site.days.map((d) => d.date.slice(0, 7)));
  months.forEach((m, i) => add(`${monthPath(m)}index.html`, renderMonthPage(ctx, months, i)));

  const years = unique(site.days.map((d) => d.date.slice(0, 4)));
  for (const y of years) add(`${y}/index.html`, renderYearPage(ctx, y));

  add("archive/index.html", renderArchivePage(ctx));
  add("search/index.html", renderSearchPage(ctx));
  for (const page of site.pages) add(`${page.slug}/index.html`, renderPage(ctx, page));
  add("rss.xml", renderRss(ctx));
  add("404.html", render404(ctx));
  add("style.css", STYLESHEET);
  add("porridge.js", SCRIPT);
  return files;
}

// ---------------------------------------------------------------------------
// URLs

const dayPath = (date: string) => `${date.replace(/-/g, "/")}/`;
const monthPath = (month: string) => `${month.replace("-", "/")}/`;

function permalink(ctx: Ctx, entry: Entry, absolute = false): string {
  const prefix = absolute ? ctx.site.settings.baseUrl : ctx.base;
  return `${prefix}${dayPath(entry.date)}#${entry.anchor}`;
}

// ---------------------------------------------------------------------------
// Pages

function renderHome(ctx: Ctx): string {
  const { days, settings } = ctx.site;
  const shown = days.slice(0, settings.homeDays);
  const next = days[settings.homeDays];
  const body = shown.map((d) => renderDay(ctx, d));
  if (shown.length === 0) body.push(`<p class="empty">Nothing here yet.</p>`);
  body.push(
    pager(
      undefined,
      next && { href: `${ctx.base}${monthPath(next.date.slice(0, 7))}`, label: "Older posts" },
    ),
  );
  return layout(ctx, { title: "", body: body.join("\n"), current: "home" });
}

function renderDayPage(ctx: Ctx, i: number): string {
  const { days } = ctx.site;
  const day = days[i]!;
  const newer = days[i - 1];
  const older = days[i + 1];
  const body = [
    renderDay(ctx, day),
    pager(
      newer && { href: `${ctx.base}${dayPath(newer.date)}`, label: longDayLabel(newer.date) },
      older && { href: `${ctx.base}${dayPath(older.date)}`, label: longDayLabel(older.date) },
    ),
  ];
  // Day pages are what search indexes (home, month and year pages repeat them).
  return layout(ctx, { title: longDayLabel(day.date), body: body.join("\n"), indexed: true });
}

function renderMonthPage(ctx: Ctx, months: string[], i: number): string {
  const month = months[i]!;
  const newer = months[i - 1];
  const older = months[i + 1];
  const days = ctx.site.days.filter((d) => d.date.startsWith(month));
  const body = [
    `<h1 class="page-title">${esc(monthLabel(month))}</h1>`,
    ...days.map((d) => renderDay(ctx, d)),
    pager(
      newer ? { href: `${ctx.base}${monthPath(newer)}`, label: monthLabel(newer) } : undefined,
      older ? { href: `${ctx.base}${monthPath(older)}`, label: monthLabel(older) } : undefined,
    ),
  ];
  return layout(ctx, { title: monthLabel(month), body: body.join("\n") });
}

function renderYearPage(ctx: Ctx, year: string): string {
  const days = ctx.site.days.filter((d) => d.date.startsWith(year));
  const body = [`<h1 class="page-title">${esc(year)}</h1>`, renderCalendarList(ctx, days)];
  return layout(ctx, { title: year, body: body.join("\n") });
}

function renderArchivePage(ctx: Ctx): string {
  const years = unique(ctx.site.days.map((d) => d.date.slice(0, 4)));
  const body = [`<h1 class="page-title">Archive</h1>`];
  for (const y of years) {
    body.push(`<h2><a href="${ctx.base}${y}/">${y}</a></h2>`);
    body.push(renderCalendarList(ctx, ctx.site.days.filter((d) => d.date.startsWith(y))));
  }
  if (years.length === 0) body.push(`<p class="empty">Nothing here yet.</p>`);
  return layout(ctx, { title: "Archive", body: body.join("\n"), current: "archive" });
}

/** Months with links to each day, as used on year and archive pages. */
function renderCalendarList(ctx: Ctx, days: Day[]): string {
  const out = [`<ul class="calendar">`];
  for (const m of unique(days.map((d) => d.date.slice(0, 7)))) {
    const links = days
      .filter((d) => d.date.startsWith(m))
      .map((d) => `<a href="${ctx.base}${dayPath(d.date)}">${Number(d.date.slice(8))}</a>`);
    out.push(
      `<li><a class="calendar-month" href="${ctx.base}${monthPath(m)}">${esc(monthLabel(m))}</a> ` +
        `<span class="calendar-days">${links.join(" ")}</span></li>`,
    );
  }
  out.push(`</ul>`);
  return out.join("\n");
}

function renderPage(ctx: Ctx, page: Page): string {
  const body = [`<h1 class="page-title">${esc(page.title)}</h1>`, ...renderPageNodes(ctx.md, page.body, 1)];
  return layout(ctx, {
    title: page.title,
    body: `<article class="page">\n${body.join("\n")}\n</article>`,
    current: page.slug,
    indexed: true,
  });
}

/**
 * Search, powered by Pagefind. The index (/pagefind/) is built after the
 * site by the GitHub Action; without it the page says search isn't ready.
 */
function renderSearchPage(ctx: Ctx): string {
  const b = ctx.base;
  const body = `<h1 class="page-title">Search</h1>
<div id="search" class="search"><noscript><p class="empty">Search needs JavaScript.</p></noscript></div>
<script src="${b}pagefind/pagefind-ui.js"></script>
<script>
(function () {
  var el = document.getElementById("search");
  if (!window.PagefindUI) {
    el.innerHTML = '<p class="empty">Search isn\u2019t available yet. Its index is built when the site is published.</p>';
    return;
  }
  var ui = new PagefindUI({ element: "#search", showSubResults: true, showImages: false, autofocus: true, resetStyles: false });
  var q = new URLSearchParams(location.search).get("q");
  if (q) ui.triggerSearch(q);
})();
</script>`;
  return layout(ctx, {
    title: "Search",
    body,
    current: "search",
    head: `<link rel="stylesheet" href="${b}pagefind/pagefind-ui.css">`,
  });
}

function render404(ctx: Ctx): string {
  const body = `<h1 class="page-title">Not found</h1>\n<p>There's nothing at this address. Try the <a href="${ctx.base}">home page</a> or the <a href="${ctx.base}archive/">archive</a>.</p>`;
  return layout(ctx, { title: "Not found", body });
}

// ---------------------------------------------------------------------------
// Days and entries

function renderDay(ctx: Ctx, day: Day): string {
  return [
    // For search: the date is the result's title, not part of its text.
    `<section class="day" data-pagefind-meta="title:${esc(longDayLabel(day.date))}">`,
    `<h2 class="day-title" data-pagefind-ignore><a href="${ctx.base}${dayPath(day.date)}">${esc(longDayLabel(day.date))}</a></h2>`,
    ...day.entries.map((e) => renderEntry(ctx.md, e, permalink(ctx, e))),
    `</section>`,
  ].join("\n");
}

function renderEntry(md: InlineRenderer, entry: Entry, href: string): string {
  // Every entry gets a "#" link, hung in the left margin beside its first line.
  const hash = `<a class="permalink" href="${href}" title="Link to this entry" aria-label="Link to this entry" data-pagefind-ignore>#</a>`;
  const out = [`<article class="entry" id="${entry.anchor}">`];
  if (entry.body === null) {
    const html = md.html(entry.text);
    // A post that starts with a captioned image: the "#" goes just before the
    // caption text, rather than beside the top of the image.
    const caption = /<span class="caption" aria-hidden="true">([^<]*)<\/span>/;
    if (html.startsWith(`<span class="figure">`) && caption.test(html)) {
      const withHash = html.replace(caption, (c) => `<span class="caption-line">${hash}${c}</span>`);
      out.push(`<p>${withHash}</p>`);
    } else {
      out.push(`<p>${hash}${html}</p>`);
    }
  } else {
    const title = md.html(entry.text);
    // A title that already contains a link can't be wrapped in another one.
    out.push(
      title.includes("<a ")
        ? `<h3 class="entry-title">${hash}${title}</h3>`
        : `<h3 class="entry-title">${hash}<a href="${href}">${title}</a></h3>`,
    );
    out.push(...renderBlocks(md, entry.body));
  }
  out.push(`</article>`);
  return out.join("\n");
}

/** Body nodes: paragraphs, with children becoming a nested list. */
function renderBlocks(md: InlineRenderer, nodes: Outline[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    out.push(`<p>${md.html(text(node))}</p>`);
    const kids = publishedChildren(node);
    if (kids.length) out.push(renderList(md, kids));
  }
  return out;
}

function renderList(md: InlineRenderer, nodes: Outline[]): string {
  const items = nodes.map((n) => {
    const kids = publishedChildren(n);
    return `<li>${md.html(text(n))}${kids.length ? "\n" + renderList(md, kids) + "\n" : ""}</li>`;
  });
  return `<ul>\n${items.join("\n")}\n</ul>`;
}

/** Page nodes: h2/h3/h4 sections for the first three levels, then lists. */
function renderPageNodes(md: InlineRenderer, nodes: Outline[], depth: number): string[] {
  if (depth > 3) return renderBlocks(md, nodes);
  const out: string[] = [];
  for (const node of nodes) {
    const kids = publishedChildren(node);
    if (kids.length === 0) {
      out.push(`<p>${md.html(text(node))}</p>`);
    } else {
      const h = `h${depth + 1}`;
      out.push(`<section>`, `<${h}>${md.html(text(node))}</${h}>`, ...renderPageNodes(md, kids, depth + 1), `</section>`);
    }
  }
  return out;
}

const text = (node: Outline) => attr(node, "text") ?? "";

// ---------------------------------------------------------------------------
// RSS

function renderRss(ctx: Ctx): string {
  const { settings, days } = ctx.site;
  const entries = days.flatMap((d) => d.entries).slice(0, settings.rssItems);
  const pubDate = (e: Entry) => formatRfc822(e.created ?? zonedMidnight(e.date, settings.timezone));

  const items = entries.map((e) => {
    const link = permalink(ctx, e, true);
    const html =
      e.body === null ? `<p>${ctx.mdAbs.html(e.text)}</p>` : renderBlocks(ctx.mdAbs, e.body).join("\n");
    return [
      `    <item>`,
      ...(e.body !== null ? [`      <title>${escXml(ctx.mdAbs.plain(e.text))}</title>`] : []),
      `      <link>${escXml(link)}</link>`,
      `      <guid isPermaLink="true">${escXml(link)}</guid>`,
      `      <pubDate>${pubDate(e)}</pubDate>`,
      `      <description>${escXml(html)}</description>`,
      `    </item>`,
    ].join("\n");
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    `  <channel>`,
    `    <title>${escXml(settings.title)}</title>`,
    `    <link>${escXml(settings.baseUrl)}</link>`,
    `    <description>${escXml(settings.description)}</description>`,
    `    <language>${escXml(settings.language)}</language>`,
    `    <atom:link href="${escXml(settings.baseUrl)}rss.xml" rel="self" type="application/rss+xml"/>`,
    `    <generator>porridge</generator>`,
    ...(entries[0] ? [`    <lastBuildDate>${pubDate(entries[0])}</lastBuildDate>`] : []),
    ...items,
    `  </channel>`,
    `</rss>`,
    ``,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Layout

interface Link {
  href: string;
  label: string;
}

function pager(newer: Link | undefined, older: Link | undefined): string {
  if (!newer && !older) return "";
  const n = newer ? `<a class="newer" href="${newer.href}">← ${esc(newer.label)}</a>` : "<span></span>";
  const o = older ? `<a class="older" href="${older.href}">${esc(older.label)} →</a>` : "<span></span>";
  return `<nav class="pager" data-pagefind-ignore>${n}${o}</nav>`;
}

function layout(
  ctx: Ctx,
  opts: {
    title: string;
    body: string;
    current?: string;
    /** Include this page in search. */
    indexed?: boolean;
    /** Extra tags for <head>. */
    head?: string;
  },
): string {
  const s = ctx.site.settings;
  const title = opts.title ? `${opts.title} – ${s.title}` : s.title;
  const navLinks: { key: string; href: string; label: string }[] = [
    ...ctx.site.nav.map((p) => ({ key: p.slug, href: `${ctx.base}${p.slug}/`, label: p.navLabel })),
    { key: "archive", href: `${ctx.base}archive/`, label: "Archive" },
  ];
  const current = (key: string) => (key === opts.current ? ` aria-current="page"` : "");
  const nav = [
    ...navLinks.map((l) => `<a href="${l.href}"${current(l.key)}>${esc(l.label)}</a>`),
    `<a class="search-link" href="${ctx.base}search/" aria-label="Search" title="Search"${current("search")}>` +
      `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.5 12.5L17 17"/></svg></a>`,
  ].join("\n");
  const owner = s.ownerName ? `${esc(s.ownerName)} · ` : "";

  return `<!doctype html>
<html lang="${esc(s.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${ctx.base}style.css">
<script src="${ctx.base}porridge.js" defer></script>
<link rel="alternate" type="application/rss+xml" title="${esc(s.title)}" href="${s.baseUrl}rss.xml">
<meta name="generator" content="porridge">
${opts.head ? `${opts.head}\n` : ""}</head>
<body>
<header class="site-header">
<a class="site-title" href="${ctx.base}"${opts.current === "home" ? ` aria-current="page"` : ""}>${esc(s.title)}</a>
${s.description ? `<p class="site-description">${esc(s.description)}</p>\n` : ""}<nav class="site-nav">
${nav}
</nav>
</header>
<main${opts.indexed ? " data-pagefind-body" : ""}>
${opts.body}
</main>
<footer class="site-footer">
<p>${owner}<a href="${ctx.base}rss.xml">RSS</a> · Made with <a href="https://github.com/alexjj/porridge">porridge</a></p>
</footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Utilities

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const escXml = esc;

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
