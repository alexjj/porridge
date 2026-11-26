// The editor's state: the open files, what's being edited, undo/redo, and
// autosave to the browser.

import { flushSync } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { createInlineRenderer, isPlaceholderUrl, parseRfc822, slugProblem, zonedDate, zonedTimeCode } from "@porridge/core";
import { imagePath } from "../model/images.js";
import { readNav, writeNav, type NavEntry } from "../model/nav.js";
import { outlineToHtml, outlineToText } from "../model/clipboard.js";
import { addEntry, blogTimezone, ensureEntryTimes } from "../model/calendar.js";
import { ancestors, block, locate, neighbour, type Block, type Focus, type Tree } from "../model/ops.js";
import {
  slugify,
  fileFromOpml,
  fileHead,
  fileToOpml,
  isYearFile,
  newFile,
  newNode,
  pagePath,
  pageSlug,
  setHead,
  stableKey,
  walk,
  type EFile,
  type ENode,
} from "../model/tree.js";
import { kv } from "./persist.js";
import { STARTER, STARTER_IMAGES } from "./starter.js";
import { prepareImage, toBase64 } from "./photos.js";
import { download, zip } from "./zip.js";

type Snapshot = Record<string, EFile | null>;

interface UndoEntry {
  files: Snapshot;
  focus: Focus | null;
  current: string;
  kind: string;
  nodeId?: string;
  time: number;
}

interface Meta {
  current: string;
  /** Stable keys of collapsed nodes, per file. */
  collapsed: Record<string, string[]>;
}

const FILE_PREFIX = "file:";
const IMAGE_PREFIX = "image:";
const UNDO_LIMIT = 200;
/** Typing in the same node within this many ms is one undo step. */
const TYPING_GAP = 1500;

export class Workspace {
  files: Record<string, EFile> = $state({});
  current = $state("");
  zoomIds: Record<string, string | null> = $state({});
  collapsed = new SvelteSet<string>();
  editingId: string | null = $state(null);
  status: "loading" | "saved" | "saving" | "error" = $state("loading");
  error = $state("");
  /** Bumped on every content change (drives the preview). */
  version = $state(0);
  /** The site's address when Blog settings leave it empty: the repo's Pages address, once connected. */
  defaultSiteBase = $state("/");
  /** Where `/images/…` loads from in the editor (the repo, once connected). */
  imageBase = $state("/");
  // Videos show as thumbnails in the outline: a player would get in the way of editing.
  md = $derived(createInlineRenderer(this.siteBase, this.imageBase, "thumbnail"));
  /** Called after any content change. */
  onChange: (() => void) | undefined;
  /** Images added in this browser (path → object URL), shown before and just after upload. */
  localImages: Record<string, string> = $state({ ...STARTER_IMAGES });
  /** Images not saved to GitHub yet. */
  pendingImages: string[] = $state([]);
  /** The node whose menu is open, and where it was opened. */
  menu: { id: string; x: number; y: number } | null = $state(null);
  /** A link or image is being added to a node, replacing [start, end) of its text. */
  inserting: { kind: "link" | "image"; id: string; start: number; end: number; selected: string; file?: File } | null =
    $state(null);
  /**
   * Several lines selected, from `anchor` to `head`. When `sticky` (started
   * from the line menu, for touch screens), tapping a line extends it.
   */
  selection: { anchor: string; head: string; sticky: boolean } | null = $state(null);
  /** The line a mouse drag started on, while the button is held. */
  dragAnchor: string | null = null;
  /** Every line shown as selected: the selected lines and everything in them. */
  selectedIds: Set<string> = $derived.by(() => {
    const ids = new Set<string>();
    const b = this.block;
    if (b) for (const n of walk(b.list.slice(b.start, b.end + 1))) ids.add(n.id);
    return ids;
  });
  /** A short message shown briefly at the bottom ("Link copied"). */
  toast = $state("");
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** Opens the photo picker for a node, to insert at a range; set up by the app. */
  pickImage: ((node: ENode, range: { start: number; end: number } | null) => void) | undefined;

  notify(message: string) {
    this.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = ""), 2500);
  }

  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private dirty = new Set<string>();
  private deleted = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** When the oldest unsaved change was made (0 when nothing is pending). */
  private pendingSince = 0;

  get file(): EFile | undefined {
    return this.files[this.current];
  }

  get zoom(): ENode | null {
    const id = this.zoomIds[this.current];
    const file = this.file;
    return (id && file && locate(file.nodes, id)?.node) || null;
  }

  /** The published site's address, so links in the editor open the live site. */
  get siteBase(): string {
    const blog = this.files["blog.opml"];
    const url = blog && fileHead(blog, "porridge:baseUrl");
    if (!url || !/^https?:\/\//.test(url) || isPlaceholderUrl(url)) return this.defaultSiteBase;
    return url.endsWith("/") ? url : `${url}/`;
  }

  get timezone(): string {
    return blogTimezone(this.files);
  }

  tree(): Tree {
    return { roots: this.file?.nodes ?? [], collapsed: this.collapsed, zoom: this.zoom };
  }

  /** The run of sibling lines the selection covers, if any. */
  get block(): Block | null {
    const s = this.selection;
    return s && this.file ? block(this.tree(), s.anchor, s.head) : null;
  }

  /** Select from `anchor` to `head`. Returns false if those lines can't be selected together. */
  select(anchor: string, head: string, sticky = this.selection?.sticky ?? false): boolean {
    if (!this.file || !block(this.tree(), anchor, head)) return false;
    this.selection = { anchor, head, sticky };
    if (this.editingId) {
      (document.getElementById(`ta-${this.editingId}`) as HTMLTextAreaElement | null)?.blur();
      this.editingId = null;
    }
    window.getSelection()?.removeAllRanges();
    return true;
  }

  /** Shift-↑/↓: move the selection's head to the line above or below. */
  extendSelection(dir: -1 | 1) {
    const s = this.selection;
    const next = s && neighbour(this.tree(), s.head, dir);
    if (s && next) this.select(s.anchor, next.id);
  }

  clearSelection() {
    this.selection = null;
  }

  /**
   * The selected lines (with everything under them) for the clipboard: an
   * indented Markdown list, and the same as rich HTML.
   */
  selectionForClipboard(): { text: string; html: string; count: number } | null {
    const b = this.block;
    if (!b) return null;
    const nodes = b.list.slice(b.start, b.end + 1);
    return {
      text: outlineToText(nodes),
      html: outlineToHtml(nodes, (t) => this.md.html(t)),
      count: nodes.length,
    };
  }

  /** Copy the selected lines (phones: from the toolbar). */
  async copySelection(): Promise<boolean> {
    const c = this.selectionForClipboard();
    if (!c) return false;
    try {
      const item = new ClipboardItem({
        "text/plain": new Blob([c.text], { type: "text/plain" }),
        "text/html": new Blob([c.html], { type: "text/html" }),
      });
      await navigator.clipboard.write([item]);
    } catch {
      await navigator.clipboard.writeText(c.text);
    }
    this.notify(`Copied ${c.count} line${c.count === 1 ? "" : "s"}`);
    return true;
  }

  /** Run an operation on all the selected lines, as one undo step. */
  blockOp(kindName: string, fn: (t: Tree, b: Block) => boolean): boolean {
    const file = this.file;
    const b = this.block;
    if (!file || !b) return false;
    const before = this.snapshot([file.path]);
    if (!fn(this.tree(), b)) return false;
    this.record(before, kindName);
    this.changed(file);
    return true;
  }

  /** Year files (newest first) and pages, for the sidebar. */
  get years(): string[] {
    return Object.keys(this.files).filter(isYearFile).sort().reverse();
  }

  get pages(): string[] {
    return Object.keys(this.files)
      .filter((p) => p.startsWith("pages/"))
      .sort();
  }

  title(path: string): string {
    if (isYearFile(path)) return path.slice(5, 9);
    const f = this.files[path];
    return (f && fileHead(f, "title")) || path.replace(/^pages\/|\.opml$/g, "");
  }

  // -------------------------------------------------------------------------
  // Loading and saving

  async load() {
    try {
      const keys = (await kv.keys()).map(String).filter((k) => k.startsWith(FILE_PREFIX));
      if (keys.length === 0) {
        this.replaceAll(STARTER);
        return;
      }
      const files: Record<string, EFile> = {};
      for (const key of keys) {
        const path = key.slice(FILE_PREFIX.length);
        const text = await kv.get<string>(key);
        if (text !== undefined) files[path] = fileFromOpml(path, text);
      }
      this.files = files;
      this.applyMeta(await kv.get<Meta>("meta"));
      await this.loadImages();
      this.status = "saved";
    } catch (err) {
      this.status = "error";
      this.error = `Couldn't load your saved work: ${(err as Error).message}`;
    }
  }

  /** Replace the whole workspace with these OPML files. */
  replaceAll(texts: Record<string, string>) {
    const files: Record<string, EFile> = {};
    const problems: string[] = [];
    for (const [path, text] of Object.entries(texts)) {
      try {
        files[path] = fileFromOpml(path, text);
      } catch (err) {
        problems.push(`${path}: ${(err as Error).message}`);
      }
    }
    if (problems.length) throw new Error(`Some files couldn't be read:\n${problems.join("\n")}`);
    if (!files["blog.opml"]) throw new Error("There's no blog.opml in those files.");

    for (const path of Object.keys(this.files)) if (!files[path]) this.deleted.add(path);
    // Images waiting to upload belonged to the old blog.
    void this.imagesSaved(this.pendingImages);
    this.files = files;
    this.undoStack = [];
    this.redoStack = [];
    this.zoomIds = {};
    this.editingId = null;
    this.applyMeta(undefined);
    this.markDirty(Object.keys(files));
  }

  private applyMeta(meta: Meta | undefined) {
    this.collapsed.clear();
    for (const [path, file] of Object.entries(this.files)) {
      const saved = meta?.collapsed[path];
      if (saved) {
        const keys = new Set(saved);
        for (const n of walk(file.nodes)) {
          const k = stableKey(n);
          if (k && keys.has(k)) this.collapsed.add(n.id);
        }
      } else if (isYearFile(path)) {
        // First time: only the newest month is open.
        file.nodes.slice(1).forEach((m) => this.collapsed.add(m.id));
      }
    }
    this.current = meta && this.files[meta.current] ? meta.current : this.defaultFile();
  }

  private defaultFile(): string {
    return this.years[0] ?? this.pages[0] ?? "blog.opml";
  }

  private meta(): Meta {
    const collapsed: Record<string, string[]> = {};
    for (const [path, file] of Object.entries(this.files)) {
      collapsed[path] = [];
      for (const n of walk(file.nodes)) {
        const k = stableKey(n);
        if (k && this.collapsed.has(n.id)) collapsed[path].push(k);
      }
    }
    return { current: this.current, collapsed };
  }

  private markDirty(paths: string[]) {
    for (const p of paths) {
      if (this.files[p]) this.dirty.add(p);
      else this.deleted.add(p);
    }
    this.version++;
    this.scheduleSave();
    this.onChange?.();
  }

  /** Save after a pause in typing, and at least every couple of seconds while typing continues. */
  private scheduleSave() {
    if (this.status !== "error") this.status = "saving";
    const now = performance.now();
    this.pendingSince ||= now;
    clearTimeout(this.saveTimer);
    const wait = Math.max(0, Math.min(400, this.pendingSince + 2000 - now));
    this.saveTimer = setTimeout(() => void this.flush(), wait);
  }

  /** Write pending changes to the browser now. */
  async flush() {
    clearTimeout(this.saveTimer);
    this.pendingSince = 0;
    const entries: [string, unknown][] = [];
    for (const p of this.dirty) {
      const f = this.files[p];
      if (f) entries.push([FILE_PREFIX + p, fileToOpml(f)]);
    }
    for (const p of this.deleted) if (!this.files[p]) entries.push([FILE_PREFIX + p, undefined]);
    entries.push(["meta", this.meta()]);
    this.dirty.clear();
    this.deleted.clear();
    try {
      await kv.setMany(entries);
      this.status = "saved";
      this.error = "";
    } catch (err) {
      this.status = "error";
      this.error = `Couldn't save in this browser: ${(err as Error).message}`;
    }
  }

  // -------------------------------------------------------------------------
  // Undo

  private snapshot(paths: string[]): Snapshot {
    const snap: Snapshot = {};
    for (const p of paths) {
      const f = this.files[p];
      snap[p] = f ? { path: f.path, rootAttrs: { ...f.rootAttrs }, head: f.head, nodes: $state.snapshot(f.nodes) as ENode[] } : null;
    }
    return snap;
  }

  private focusNow(): Focus | null {
    const ta = this.editingId ? (document.getElementById(`ta-${this.editingId}`) as HTMLTextAreaElement | null) : null;
    return this.editingId ? { id: this.editingId, caret: ta?.selectionStart ?? 0 } : null;
  }

  private record(files: Snapshot, kind: string, nodeId?: string) {
    this.undoStack.push({ files, focus: this.focusNow(), current: this.current, kind, nodeId, time: Date.now() });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    this.step(this.undoStack, this.redoStack);
  }

  redo() {
    this.step(this.redoStack, this.undoStack);
  }

  private step(from: UndoEntry[], to: UndoEntry[]) {
    const entry = from.pop();
    if (!entry) return;
    const paths = Object.keys(entry.files);
    to.push({ ...entry, files: this.snapshot(paths), focus: this.focusNow(), current: this.current, time: 0 });
    for (const [p, f] of Object.entries(entry.files)) {
      if (f) this.files[p] = f;
      else delete this.files[p];
    }
    this.current = this.files[entry.current] ? entry.current : this.defaultFile();
    if (this.zoomIds[this.current] && !this.zoom) this.zoomIds[this.current] = null;
    this.markDirty(paths);
    if (entry.focus && this.file && locate(this.file.nodes, entry.focus.id)) this.focusNode(entry.focus.id, entry.focus.caret);
    else this.editingId = null;
  }

  // -------------------------------------------------------------------------
  // Editing

  /**
   * Run an outline operation on the current file. `result` is where focus
   * goes; `true` keeps focus on `nodeId` at `caret`; null/false means it
   * didn't apply and nothing changes.
   */
  op(kindName: string, nodeId: string, fn: (t: Tree) => Focus | boolean | null, caret = 0): boolean {
    const file = this.file;
    if (!file) return false;
    const before = this.snapshot([file.path]);
    const result = fn(this.tree());
    if (result === null || result === false) return false;
    this.record(before, kindName, nodeId);
    this.changed(file);
    const focus = result === true ? { id: nodeId, caret } : result;
    this.focusNode(focus.id, focus.caret);
    return true;
  }

  setText(node: ENode, text: string) {
    const file = this.file;
    if (!file || node.text === text) return;
    const last = this.undoStack[this.undoStack.length - 1];
    const now = Date.now();
    if (last?.kind === "type" && last.nodeId === node.id && now - last.time < TYPING_GAP) {
      last.time = now;
    } else {
      this.record(this.snapshot([file.path]), "type", node.id);
    }
    node.text = text;
    this.changed(file);
  }

  private changed(file: EFile) {
    ensureEntryTimes(file, new Date(), this.timezone);
    this.markDirty([file.path]);
  }

  /** The + button. */
  newEntry() {
    const now = new Date();
    const year = zonedDate(now, this.timezone).slice(0, 4);
    const before = this.snapshot(["blog.opml", `blog/${year}.opml`]);
    try {
      const r = addEntry(this.files, now);
      this.record(before, "entry");
      this.markDirty(r.changed);
      if (this.current !== r.path) this.open(r.path);
      const zoom = this.zoom;
      if (zoom && !ancestors(this.file!.nodes, r.id).some((a) => a.id === zoom.id)) this.zoomIds[this.current] = null;
      this.focusNode(r.id, 0);
    } catch (err) {
      this.error = (err as Error).message;
    }
  }

  /** Add an empty child to `parent` (or at the top level) and edit it. */
  addChild(parent: ENode | null) {
    const file = this.file;
    if (!file) return;
    const before = this.snapshot([file.path]);
    const list = parent ? parent.children : file.nodes;
    list.push(newNode());
    const id = list[list.length - 1]!.id;
    this.record(before, "add");
    if (parent) this.collapsed.delete(parent.id);
    this.changed(file);
    this.focusNode(id, 0);
  }

  // -------------------------------------------------------------------------
  // Settings and pages

  /** Set a head setting (empty removes it). Not undoable. */
  setHead(path: string, name: string, value: string) {
    const file = this.files[path];
    if (!file) return;
    setHead(file, name, value.trim());
    this.markDirty([path]);
  }

  // ---- The site's navigation (Blog settings) ---------------------------------

  /** Pages in the navigation, outside links and the archive, in order. */
  navEntries(): NavEntry[] {
    return readNav(this.files);
  }

  private writeNav(entries: NavEntry[]) {
    this.markDirty(writeNav(this.files, entries));
  }

  /** Move the entry at `index` up (-1) or down (1). */
  moveNav(index: number, delta: -1 | 1) {
    const entries = this.navEntries();
    const to = index + delta;
    if (to < 0 || to >= entries.length) return;
    [entries[index], entries[to]] = [entries[to]!, entries[index]!];
    this.writeNav(entries);
  }

  /** Add an empty outside link before the archive (if it's last). Returns its index. */
  addNavLink(): number {
    const entries = this.navEntries();
    const at = entries.at(-1)?.kind === "archive" ? entries.length - 1 : entries.length;
    entries.splice(at, 0, { kind: "link", label: "", url: "", order: 0 });
    this.writeNav(entries);
    return at;
  }

  updateNavLink(index: number, change: { label?: string; url?: string }) {
    const entries = this.navEntries();
    const e = entries[index];
    if (e?.kind !== "link") return;
    entries[index] = { ...e, ...change };
    this.writeNav(entries);
  }

  removeNavLink(index: number) {
    const entries = this.navEntries();
    if (entries[index]?.kind !== "link") return;
    entries.splice(index, 1);
    this.writeNav(entries);
  }

  /** Create a page and open it. Returns its path. */
  newPage(title: string, inNav: boolean): string {
    let base = slugify(title || "page");
    if (slugProblem(base)) base = `page-${base}`;
    let slug = base;
    for (let n = 2; this.files[pagePath(slug)]; n++) slug = `${base}-${n}`;
    const path = pagePath(slug);
    const before = this.snapshot([path]);
    const file = newFile(path, title.trim() || slug);
    if (inNav) setHead(file, "porridge:inNav", "true");
    file.nodes.push(newNode());
    this.files[path] = file;
    this.record(before, "page");
    this.markDirty([path]);
    this.open(path);
    this.focusNode(this.files[path]!.nodes[0]!.id, 0);
    return path;
  }

  /** Rename a page's file (its URL). Returns a problem, or undefined on success. */
  renamePage(path: string, slug: string): string | undefined {
    const problem = slugProblem(slug);
    if (problem) return problem;
    const to = pagePath(slug);
    if (to === path) return undefined;
    if (this.files[to]) return `There's already a page called "${slug}".`;
    const file = this.files[path];
    if (!file) return "That page doesn't exist.";
    this.record(this.snapshot([path, to]), "rename");
    this.files[to] = { ...file, path: to };
    delete this.files[path];
    this.zoomIds[to] = this.zoomIds[path] ?? null;
    if (this.current === path) this.current = to;
    this.markDirty([path, to]);
    return undefined;
  }

  deletePage(path: string) {
    if (!this.files[path]) return;
    this.record(this.snapshot([path]), "delete page");
    delete this.files[path];
    if (this.current === path) this.current = this.defaultFile();
    this.editingId = null;
    this.markDirty([path]);
  }

  /**
   * Replace files with versions from GitHub (null deletes). Collapse state is
   * kept where nodes can be matched. Undo history is cleared, since it no
   * longer applies.
   */
  applyRemote(updates: Record<string, string | null>) {
    const paths = Object.keys(updates);
    if (paths.length === 0) return;
    const parsed: Record<string, EFile | null> = {};
    for (const [p, text] of Object.entries(updates)) parsed[p] = text === null ? null : fileFromOpml(p, text);
    const keep = this.meta().collapsed;
    for (const [p, f] of Object.entries(parsed)) {
      if (f === null) {
        delete this.files[p];
        continue;
      }
      const keys = new Set(keep[p] ?? []);
      this.files[p] = f;
      for (const n of walk(f.nodes)) {
        const k = stableKey(n);
        if (k && keys.has(k)) this.collapsed.add(n.id);
      }
    }
    if (paths.includes(this.current)) this.editingId = null;
    if (!this.files[this.current]) this.current = this.defaultFile();
    this.undoStack = [];
    this.redoStack = [];
    this.markDirty(paths);
  }

  // -------------------------------------------------------------------------
  // View

  open(path: string) {
    if (!this.files[path]) return;
    this.current = path;
    this.editingId = null;
    this.selection = null;
    this.scheduleSave();
  }

  zoomTo(id: string | null) {
    this.zoomIds[this.current] = id;
    this.editingId = null;
    this.selection = null;
  }

  toggle(id: string) {
    this.setCollapsed(id, !this.collapsed.has(id));
  }

  setCollapsed(id: string, collapse: boolean) {
    const node = this.file && locate(this.file.nodes, id)?.node;
    if (!node || !node.children.length || this.collapsed.has(id) === collapse) return;
    if (collapse) this.collapsed.add(id);
    else this.collapsed.delete(id);
    this.scheduleSave();
  }

  /** Edit node `id` with the caret at `caret`; empty id stops editing. */
  focusNode(id: string, caret: number) {
    if (!id || !this.file) {
      this.editingId = null;
      return;
    }
    for (const a of ancestors(this.file.nodes, id)) this.collapsed.delete(a.id);
    this.selection = null;
    this.editingId = id;
    flushSync();
    const ta = document.getElementById(`ta-${id}`) as HTMLTextAreaElement | null;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    }
  }

  // -------------------------------------------------------------------------
  // Node menu actions

  /** Replace [start, end) of a node's text and continue editing after it. */
  insertInto(id: string, start: number, end: number, snippet: string) {
    const file = this.file;
    const node = file && locate(file.nodes, id)?.node;
    if (!file || !node) return;
    this.record(this.snapshot([file.path]), "insert", id);
    node.text = node.text.slice(0, start) + snippet + node.text.slice(end);
    this.changed(file);
    this.focusNode(id, start + snippet.length);
  }

  /** Turn a true/false attribute such as isDraft on or off. */
  setFlag(id: string, name: "isDraft" | "isComment", on: boolean) {
    this.setAttr(id, name, on ? "true" : null);
  }

  /** Set (or with null, remove) one of a line's attributes, as an undo step. */
  setAttr(id: string, name: string, value: string | null) {
    const file = this.file;
    const node = file && locate(file.nodes, id)?.node;
    if (!file || !node || node.attrs[name] === (value ?? undefined)) return;
    this.record(this.snapshot([file.path]), "attribute", id);
    if (value === null) delete node.attrs[name];
    else node.attrs[name] = value;
    this.changed(file);
  }

  /** Delete any node, calendar headings included, without moving focus. */
  removeNode(id: string) {
    const file = this.file;
    const loc = file && locate(file.nodes, id);
    if (!file || !loc) return;
    this.record(this.snapshot([file.path]), "remove", id);
    if (this.editingId && (this.editingId === id || ancestors(file.nodes, this.editingId).some((a) => a.id === id))) {
      this.editingId = null;
    }
    if (this.zoomIds[file.path] && (this.zoomIds[file.path] === id || ancestors(file.nodes, this.zoomIds[file.path]!).some((a) => a.id === id))) {
      this.zoomIds[file.path] = loc.parent?.id ?? null;
    }
    loc.siblings.splice(loc.index, 1);
    this.changed(file);
  }

  /** The published address of a node: its entry's anchor on the day page, a day, a month or a page. */
  permalink(id: string): string | null {
    const base = this.siteBase;
    const file = this.file;
    if (base === "/" || !file) return null;
    if (file.path.startsWith("pages/")) return `${base}${pageSlug(file.path)}/`;
    if (!isYearFile(file.path)) return null;
    const node = locate(file.nodes, id)?.node;
    if (!node) return null;
    const [month, day, entry] = [...ancestors(file.nodes, id), node];
    if (!day) return month?.attrs.date ? `${base}${month.attrs.date.replace("-", "/")}/` : null;
    const dayUrl = day.attrs.date ? `${base}${day.attrs.date.replace(/-/g, "/")}/` : null;
    const created = entry?.attrs.created ? parseRfc822(entry.attrs.created) : undefined;
    if (!dayUrl || !created) return dayUrl;
    return `${dayUrl}#a${zonedTimeCode(created, this.timezone)}`;
  }

  // -------------------------------------------------------------------------
  // Images

  /** Node text as HTML, with images added in this browser shown from memory. */
  renderText(text: string): string {
    let html = this.md.html(text);
    if (html.includes("<img")) {
      for (const [path, url] of Object.entries(this.localImages)) {
        html = html.replaceAll(`src="${this.imageBase}${path}"`, `src="${url}"`);
      }
    }
    return html;
  }

  /** Resize a picked photo and keep it in the browser until the next save. Returns its path. */
  async addImage(file: File): Promise<string> {
    const prepared = await prepareImage(file);
    const now = new Date();
    let path = imagePath(file.name, zonedDate(now, this.timezone), zonedTimeCode(now, this.timezone), prepared.ext);
    for (let n = 2; this.localImages[path]; n++) path = path.replace(/(-\d+)?(\.\w+)$/, `-${n}$2`);
    await kv.setMany([[IMAGE_PREFIX + path, prepared.blob]]);
    this.localImages[path] = URL.createObjectURL(prepared.blob);
    this.pendingImages = [...this.pendingImages, path];
    this.version++;
    this.onChange?.();
    return path;
  }

  /**
   * The starter blog's images that the blog still uses, base64 encoded: for
   * uploading this browser's blog to a repository that has none.
   */
  async starterImageUploads(): Promise<Record<string, string>> {
    const all = Object.values(this.texts()).join("\n");
    const out: Record<string, string> = {};
    for (const [path, url] of Object.entries(STARTER_IMAGES)) {
      if (!all.includes(`/${path}`)) continue;
      const res = await fetch(url);
      if (res.ok) out[path] = await toBase64(await res.blob());
    }
    return out;
  }

  /** Pending images, base64 encoded, for uploading. */
  async imageUploads(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const p of this.pendingImages) {
      const blob = await kv.get<Blob>(IMAGE_PREFIX + p);
      if (blob) out[p] = await toBase64(blob);
    }
    return out;
  }

  /** These images are on GitHub now (or no longer wanted): stop keeping them. */
  async imagesSaved(paths: string[]) {
    if (!paths.length) return;
    this.pendingImages = this.pendingImages.filter((p) => !paths.includes(p));
    await kv.setMany(paths.map((p) => [IMAGE_PREFIX + p, undefined]));
  }

  private async loadImages() {
    const keys = (await kv.keys()).map(String).filter((k) => k.startsWith(IMAGE_PREFIX));
    for (const key of keys) {
      const blob = await kv.get<Blob>(key);
      if (blob) this.localImages[key.slice(IMAGE_PREFIX.length)] = URL.createObjectURL(blob);
    }
    this.pendingImages = keys.map((k) => k.slice(IMAGE_PREFIX.length));
  }

  // -------------------------------------------------------------------------
  // Import and export

  downloadCurrent() {
    const file = this.file;
    if (!file) return;
    download(file.path.split("/").pop()!, new Blob([fileToOpml(file)], { type: "text/x-opml" }));
  }

  /** Everything in the browser: text files and images not uploaded yet. */
  async downloadAll() {
    const files: { path: string; data: string | Uint8Array }[] = Object.values(this.files).map((f) => ({
      path: f.path,
      data: fileToOpml(f),
    }));
    for (const p of this.pendingImages) {
      const blob = await kv.get<Blob>(IMAGE_PREFIX + p);
      if (blob) files.push({ path: p, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    download("blog.zip", zip(files));
  }

  /** Text of every file, for the preview. */
  texts(): Record<string, string> {
    return Object.fromEntries(Object.values(this.files).map((f) => [f.path, fileToOpml(f)]));
  }
}
