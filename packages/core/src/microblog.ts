// micro.blog → Porridge. Converts the posts in a micro.blog Blog Archive's
// feed.json (JSON Feed, with each post's Markdown in `content_text`) into
// entries, and lists the images and videos to copy out of the archive's
// `uploads/` folder. Pure: reading the zip and resizing images is the
// caller's job.
import { formatRfc822, zonedDate, zonedTimeCode } from "./dates.js";
import { imagePath } from "./images.js";

export interface MicroblogItem {
  id?: string;
  url?: string;
  title?: string;
  content_text?: string;
  date_published?: string;
  tags?: string[];
}

/** A line of the outline, before it becomes an editor node. */
export interface ImportLine {
  text: string;
  attrs?: Record<string, string>;
  children?: ImportLine[];
}

export interface ImportedPost {
  /** The post's address on micro.blog (kept as `importedFrom`). */
  url: string;
  /** `YYYY-MM-DD` in the blog's timezone. */
  date: string;
  /** The entry: `created`, `importedFrom` and the rest are in its attrs. */
  line: ImportLine;
  /** Things that didn't convert cleanly, for the "needs a look" list. */
  notes: string[];
}

export interface MediaJob {
  /** Path in the archive, e.g. `uploads/2025/abc.jpg` (never a -m/-s thumbnail). */
  source: string;
  /** Path in the blog, e.g. `images/2025/09/abc-12075859.webp`. Images may end up in another format: see `retarget`. */
  target: string;
  kind: "image" | "video";
  /** The address a post first used for it (to fall back to if it's not in the archive). */
  url: string;
}

export interface MicroblogImport {
  posts: ImportedPost[];
  media: MediaJob[];
  /** Items that couldn't be read at all. */
  skipped: string[];
}

/** Convert a parsed feed.json. Posts come back oldest first. */
export function convertMicroblog(feed: unknown, timezone: string): MicroblogImport {
  const items = (feed as { items?: unknown })?.items;
  const home = String((feed as { home_page_url?: unknown })?.home_page_url ?? "https://micro.blog/");
  if (!Array.isArray(items)) throw new Error("This isn't a micro.blog archive: its feed.json has no posts.");
  const media = new Map<string, MediaJob>();
  const posts: ImportedPost[] = [];
  const skipped: string[] = [];
  for (const raw of items as MicroblogItem[]) {
    const created = new Date(raw?.date_published ?? "");
    const url = raw?.url ?? raw?.id ?? "";
    if (Number.isNaN(created.getTime())) {
      skipped.push(`${url || "A post"}: no date`);
      continue;
    }
    const date = zonedDate(created, timezone);
    const ctx: Ctx = { home, date, time: zonedTimeCode(created, timezone), notes: [], media };
    const blocks = toBlocks(raw.content_text ?? "", ctx);
    const title = (raw.title ?? "").trim();

    const attrs: Record<string, string> = { created: formatRfc822(created) };
    if (raw.tags?.length) attrs.category = raw.tags.join(", ");
    if (url) attrs.importedFrom = url;

    let line: ImportLine;
    if (title) {
      line = { text: title, attrs, children: blocks };
    } else if (blocks.length === 0) {
      skipped.push(`${url}: empty`);
      continue;
    } else {
      const [first, ...rest] = blocks as [ImportLine, ...ImportLine[]];
      const children = [...(first.children ?? []), ...rest];
      if (first.children?.length) ctx.notes.push("starts with a list, now shown as paragraphs");
      if (children.length && /^>/.test(first.text)) ctx.notes.push("starts with a quote");
      line = {
        text: first.text,
        attrs: { ...attrs, ...(children.length ? { isUntitled: "true" } : {}) },
        children,
      };
    }
    posts.push({ url, date, line, notes: ctx.notes });
  }
  posts.sort((a, b) => new Date(a.line.attrs!.created!).getTime() - new Date(b.line.attrs!.created!).getTime());
  return { posts, media: [...media.values()], skipped };
}

/** After choosing another format for an image, point its posts at the new path. */
export function retarget(result: MicroblogImport, from: string, to: string) {
  replaceInPosts(result, `/${from}`, `/${to}`);
  for (const m of result.media) if (m.target === from) m.target = to;
}

/** A file that isn't in the archive: its posts keep the address they had. */
export function unlinkMedia(result: MicroblogImport, job: MediaJob) {
  replaceInPosts(result, `/${job.target}`, job.url);
  result.media = result.media.filter((m) => m !== job);
}

function replaceInPosts(result: MicroblogImport, find: string, replace: string) {
  const fix = (l: ImportLine) => {
    l.text = l.text.split(find).join(replace);
    l.children?.forEach(fix);
  };
  for (const p of result.posts) fix(p.line);
}

// ---------------------------------------------------------------------------

interface Ctx {
  /** The micro.blog site's address, for uploads referred to relatively. */
  home: string;
  date: string;
  time: string;
  notes: string[];
  media: Map<string, MediaJob>;
}

const note = (ctx: Ctx, n: string) => {
  if (!ctx.notes.includes(n)) ctx.notes.push(n);
};

/** An uploaded file's path in the archive, from any of the ways a post refers to it. */
export function uploadSource(url: string): string | undefined {
  let m = /^(?:https?:\/\/[^/]+)?\/?uploads\/(\d{4})\/([^?#\s"')]+)$/.exec(url);
  if (m) return `uploads/${m[1]}/${m[2]}`;
  // Photo collections use micro.blog's CDN; the -m and -s files are thumbnails.
  m = /^https?:\/\/[a-z0-9.-]*uploads\.micro\.blog\/\d+\/(\d{4})\/([^?#\s"')]+)$/.exec(url);
  if (m) return `uploads/${m[1]}/${m[2]!.replace(/-[ms](\.\w+)$/, "$1")}`;
  return undefined;
}

/** Register an upload and return its address in the blog (root-relative), or the URL unchanged. */
function mediaUrl(ctx: Ctx, url: string, kind: MediaJob["kind"]): string {
  const source = uploadSource(url);
  if (!source) return url;
  let job = ctx.media.get(source);
  if (!job) {
    const name = source.split("/").pop()!;
    const ext = kind === "video" ? (name.split(".").pop() ?? "mp4").toLowerCase() : "webp";
    const first = imagePath(name, ctx.date, ctx.time, ext);
    const taken = new Set([...ctx.media.values()].map((j) => j.target));
    let target = first;
    for (let n = 2; taken.has(target); n++) target = first.replace(/\.\w+$/, `-${n}.${ext}`);
    let absolute = url;
    try {
      absolute = new URL(url, ctx.home).href;
    } catch {
      // keep it as written
    }
    job = { source, target, kind, url: absolute };
    ctx.media.set(source, job);
  }
  return `/${job.target}`;
}

/** Alt text that's really a file name ("A274A4….jpg") isn't a description. */
const cleanAlt = (alt: string) => (/\.(jpe?g|png|gif|webp|heic|mp4|mov)$/i.test(alt.trim()) ? "" : alt.trim());
const mdAlt = (alt: string) => cleanAlt(alt).replace(/([[\]])/g, "\\$1");

function attrOf(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[2] ?? m[3]) : undefined;
}

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const YT = (id: string) => `https://youtu.be/${id}`;

/** Markdown (with some HTML) → lines. */
function toBlocks(source: string, ctx: Ctx): ImportLine[] {
  let text = source.replace(/\r\n?/g, "\n");

  // Code blocks are kept whole, as <pre>, so nothing inside them is touched.
  const code: string[] = [];
  text = text.replace(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm, (_m, body: string) => {
    code.push(body.replace(/\n$/, ""));
    return `\n\n\u0000${code.length - 1}\u0000\n\n`;
  });

  // HTML images become Markdown images on lines of their own.
  text = text.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (_m, inner: string) => {
    const img = /<img\b[^>]*>/i.exec(inner)?.[0] ?? "";
    const caption = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(inner)?.[1]?.trim();
    const src = attrOf(img, "src");
    if (!src) return _m;
    return `\n\n![${mdAlt(decode(caption ?? attrOf(img, "alt") ?? ""))}](${src})\n\n`;
  });
  text = text.replace(/<div class="microblog_collection"[^>]*>([\s\S]*?)<\/div>/gi, (_m, inner: string) => {
    const imgs = inner.match(/<img\b[^>]*>/gi) ?? [];
    return (
      "\n\n" +
      imgs
        .map((img) => `![${mdAlt(decode(attrOf(img, "alt") ?? ""))}](${attrOf(img, "data-microblog-lightbox") ?? attrOf(img, "src")})`)
        .join("\n\n") +
      "\n\n"
    );
  });
  text = text.replace(/<img\b[^>]*>/gi, (img) => {
    const src = attrOf(img, "src");
    return src ? `![${mdAlt(decode(attrOf(img, "alt") ?? ""))}](${src})` : img;
  });
  text = text.replace(/<video\b[^>]*>[\s\S]*?<\/video>|<video\b[^>]*\/>/gi, (tag) => {
    const src = attrOf(tag, "src") ?? attrOf(/<source\b[^>]*>/i.exec(tag)?.[0] ?? "", "src");
    return src ? `\n\n\u0001${src}\n\n` : tag;
  });
  // YouTube: a shortcode or an embedded player becomes an address on its own line.
  text = text.replace(/\{\{<\s*(?:yt|youtube)\s+(?:id=)?"?([\w-]{11})"?\s*>\}\}/g, (_m, id: string) => `\n\n${YT(id)}\n\n`);
  text = text.replace(/<iframe\b[^>]*youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})[^>]*>\s*<\/iframe>/gi, (_m, id: string) => `\n\n${YT(id)}\n\n`);

  const footnotes = new Set<string>();
  const out: ImportLine[] = [];
  for (const para of text.split(/\n[ \t]*\n/)) {
    const lines = para.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;
    const first = lines[0]!.trim();

    // Code block.
    const codeIndex = /^\u0000(\d+)\u0000$/.exec(first);
    if (codeIndex) {
      out.push({ text: `<pre><code>${escapeCode(code[Number(codeIndex[1])]!)}</code></pre>` });
      note(ctx, "code block");
      continue;
    }
    // Video.
    if (first.startsWith("\u0001")) {
      out.push({ text: `<video controls src="${mediaUrl(ctx, first.slice(1), "video")}"></video>` });
      continue;
    }
    // Heading inside a post: a bold line.
    const heading = /^#{1,6}\s+(.*?)\s*#*$/.exec(first);
    if (lines.length === 1 && heading) {
      out.push({ text: `**${inline(heading[1]!, ctx)}**` });
      continue;
    }
    // Horizontal rule: dropped.
    if (lines.length === 1 && /^(-{3,}|\*{3,}|_{3,})$/.test(first)) {
      note(ctx, "horizontal rule left out");
      continue;
    }
    // Table: kept as HTML.
    if (lines.every((l) => l.trim().startsWith("|"))) {
      out.push({ text: tableHtml(lines, ctx) });
      note(ctx, "table");
      continue;
    }
    // Quote, with "— source" as its last line.
    if (lines.every((l) => l.trim().startsWith(">"))) {
      const quoted = lines.map((l) => l.trim().replace(/^>\s?/, "").replace(/\s*<br\s*\/?>\s*$/i, ""));
      const last = quoted.at(-1)!;
      const source = quoted.length > 1 && /^(—|--|―)\s*/.test(last) ? last.replace(/^(—|--|―)\s*/, "") : undefined;
      const body = source ? quoted.slice(0, -1) : quoted;
      out.push({ text: `>${inline(body.join("<br>"), ctx)}`, ...(source ? { children: [{ text: inline(source, ctx) }] } : {}) });
      continue;
    }
    // Footnote text: "[^1]: …" → a small numbered paragraph at the end.
    const fn = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(first);
    if (fn) {
      footnotes.add(fn[1]!);
      out.push({ text: `<sup>${fn[1]}</sup> ${inline([fn[2]!, ...lines.slice(1).map((l) => l.trim())].join(" "), ctx)}` });
      note(ctx, "footnote");
      continue;
    }

    // A paragraph, perhaps with a list after it (or just a list).
    const listStart = lines.findIndex((l) => LIST_ITEM.test(l));
    const textLines = listStart < 0 ? lines : lines.slice(0, listStart);
    const before = paragraphLines(textLines, ctx);
    out.push(...before);
    if (listStart >= 0) {
      const items = listItems(lines.slice(listStart), ctx);
      const previous = out.at(-1);
      // A "loose" list (blank lines between items) carries on the list above.
      if (!before.length && previous?.attrs?.list === "bullets") {
        previous.children!.push(...items);
        continue;
      }
      const parent = before.at(-1) ?? lastParagraph(out);
      if (parent && !parent.children?.length && !/^(!\[|>|<)/.test(parent.text)) {
        parent.attrs = { ...parent.attrs, list: "bullets" };
        parent.children = items;
      } else {
        out.push(...items.map((i) => ({ ...i, text: `• ${i.text}` })));
        note(ctx, "list without a line before it, now lines starting with •");
      }
    }
  }
  if (footnotes.size) for (const l of out) l.text = l.text.replace(/\[\^([^\]]+)\](?!:)/g, "<sup>$1</sup>");
  if (/\{\{<.*>\}\}/.test(out.map((l) => l.text).join("\n"))) note(ctx, "micro.blog shortcode (e.g. a map) left as text");
  return out;
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+/;

function lastParagraph(out: ImportLine[]): ImportLine | undefined {
  const last = out.at(-1);
  return last && !last.children?.length && !/^(!\[|>|<)/.test(last.text) ? last : undefined;
}

/** A paragraph's lines: images on lines of their own split off; other lines joined (a hard break becomes <br>). */
function paragraphLines(lines: string[], ctx: Ctx): ImportLine[] {
  const out: ImportLine[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    let joined = "";
    buf.forEach((l, i) => {
      const hard = /( {2,}|\\|<br\s*\/?>)$/i.test(l);
      const clean = l.replace(/( {2,}|\\|\s*<br\s*\/?>)$/i, "").trim();
      joined += clean + (i < buf.length - 1 ? (hard ? "<br>" : " ") : "");
    });
    joined = joined.replace(/ {2,}/g, " ");
    out.push({ text: inline(joined, ctx) });
    buf = [];
  };
  for (const l of lines) {
    const images = l.trim().match(/!\[[^\]]*\]\([^)]*\)/g);
    if (images && l.trim().replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim() === "") {
      flush();
      for (const img of images) out.push({ text: inline(img, ctx) });
    } else {
      buf.push(l);
    }
  }
  flush();
  return out;
}

function listItems(lines: string[], ctx: Ctx): ImportLine[] {
  const top: ImportLine[] = [];
  const stack: { indent: number; line: ImportLine }[] = [];
  for (const l of lines) {
    const m = LIST_ITEM.exec(l);
    if (!m) {
      // A continuation of the item above.
      const last = stack.at(-1)?.line;
      if (last) last.text += ` ${inline(l.trim(), ctx)}`;
      continue;
    }
    const indent = m[1]!.length;
    const line: ImportLine = { text: inline(l.slice(m[0].length).trim().replace(/ {2,}/g, " "), ctx) };
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const parent = stack.at(-1)?.line;
    if (parent) (parent.children ??= []).push(line);
    else top.push(line);
    stack.push({ indent, line });
  }
  return top;
}

/** Inline Markdown: point images at their copies in the blog. */
function inline(text: string, ctx: Ctx): string {
  return text.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_m, alt: string, url: string) => {
    return `![${mdAlt(alt)}](${mediaUrl(ctx, url, "image")})`;
  });
}

/** Code shown as it is: HTML escaped, Markdown characters neutralised, newlines kept. */
function escapeCode(code: string): string {
  return code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]~]/g, (c) => `&#${c.charCodeAt(0)};`)
    .replace(/\n/g, "&#10;");
}

function tableHtml(lines: string[], ctx: Ctx): string {
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => inline(c.trim(), ctx));
  const rows = lines.filter((l) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l));
  const [head, ...body] = rows.map(cells);
  const tr = (cs: string[], tag: string) => `<tr>${cs.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
  return `<table><thead>${tr(head ?? [], "th")}</thead><tbody>${body.map((r) => tr(r, "td")).join("")}</tbody></table>`;
}
