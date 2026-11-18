// The editor's state: the open files, what's being edited, undo/redo, and
// autosave to the browser.

import { flushSync } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { createInlineRenderer, zonedDate } from "@porridge/core";
import { addEntry, blogTimezone, ensureEntryTimes } from "../model/calendar.js";
import { ancestors, locate, type Focus, type Tree } from "../model/ops.js";
import {
  fileFromOpml,
  fileHead,
  fileToOpml,
  isYearFile,
  newNode,
  stableKey,
  walk,
  type EFile,
  type ENode,
} from "../model/tree.js";
import { kv } from "./persist.js";
import { STARTER } from "./starter.js";
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
  md = createInlineRenderer("/");

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

  get timezone(): string {
    return blogTimezone(this.files);
  }

  tree(): Tree {
    return { roots: this.file?.nodes ?? [], collapsed: this.collapsed, zoom: this.zoom };
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
  // View

  open(path: string) {
    if (!this.files[path]) return;
    this.current = path;
    this.editingId = null;
    this.scheduleSave();
  }

  zoomTo(id: string | null) {
    this.zoomIds[this.current] = id;
    this.editingId = null;
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
    this.editingId = id;
    flushSync();
    const ta = document.getElementById(`ta-${id}`) as HTMLTextAreaElement | null;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    }
  }

  // -------------------------------------------------------------------------
  // Import and export

  downloadCurrent() {
    const file = this.file;
    if (!file) return;
    download(file.path.split("/").pop()!, new Blob([fileToOpml(file)], { type: "text/x-opml" }));
  }

  downloadAll() {
    const files = Object.values(this.files)
      .map((f) => ({ path: f.path, text: fileToOpml(f) }))
      .sort((a, b) => a.path.localeCompare(b.path));
    download("blog.zip", zip(files));
  }

  /** Text of every file, for the preview. */
  texts(): Record<string, string> {
    return Object.fromEntries(Object.values(this.files).map((f) => [f.path, fileToOpml(f)]));
  }
}
