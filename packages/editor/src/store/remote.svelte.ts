// The editor's connection to a GitHub repository: loading from it, saving to
// it, publishing, and what's different between the two.

import { GitHub, GitHubError, pagesUrl, rawBase, type Connection } from "../github/api.js";
import { ConflictError, localChanges, pull, push, watchBuild, type Base, type BuildState } from "../github/sync.js";
import { fileFromOpml, fileToOpml } from "../model/tree.js";
import { kv } from "./persist.js";
import type { Workspace } from "./workspace.svelte.js";

type Fetch = typeof fetch;

export interface RepoCheck {
  hasBlog: boolean;
  private: boolean;
}

export class Remote {
  conn: Connection | null = $state(null);
  isPrivate = $state(false);
  /** Content files that differ from GitHub. */
  unsynced: string[] = $state([]);
  /** Files changed both here and on GitHub. */
  conflicts: string[] = $state([]);
  busy: "" | "checking" | "saving" | "publishing" = $state("");
  build: BuildState | null = $state(null);
  error = $state("");
  /** Set when a save hit conflicts and needs a decision. */
  conflictPrompt: { paths: string[]; publish: boolean } | null = $state(null);

  private base: Base | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly ws: Workspace,
    private readonly fetchFn?: Fetch,
  ) {
    ws.onChange = () => this.scheduleRefresh();
  }

  private gh(conn = this.conn!): GitHub {
    return new GitHub(conn, this.fetchFn);
  }

  get repoName(): string {
    return this.conn ? `${this.conn.owner}/${this.conn.repo}` : "";
  }

  async load() {
    this.conn = (await kv.get<Connection>("connection")) ?? null;
    this.base = (await kv.get<Base>("base")) ?? null;
    this.isPrivate = (await kv.get<boolean>("private")) ?? false;
    this.applyImageBase();
    this.refresh();
    if (this.conn) await this.check();
  }

  private async persist() {
    await kv.setMany([
      // Reactive state is a proxy, which IndexedDB can't store: save plain copies.
      ["connection", this.conn ? $state.snapshot(this.conn) : undefined],
      ["base", this.base ? $state.snapshot(this.base) : undefined],
      ["private", this.isPrivate],
    ]);
  }

  private applyImageBase() {
    this.ws.imageBase = this.conn && !this.isPrivate ? rawBase(this.conn) : "/";
    this.ws.defaultSiteBase = this.conn ? pagesUrl(this.conn) : "/";
  }

  private scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), 300);
  }

  /** Recompute which files differ from GitHub. */
  refresh() {
    this.unsynced = this.conn ? [...localChanges(this.base, this.ws.texts()), ...this.ws.pendingImages] : [];
    this.conflicts = this.conflicts.filter((p) => this.unsynced.includes(p));
  }

  /** The editor's own formatting of a file, so unchanged files compare equal. */
  private normalize(base: Base, updates: Record<string, string | null>): Record<string, string | null> {
    const problems: string[] = [];
    const out: Record<string, string | null> = {};
    for (const [p, text] of Object.entries(updates)) {
      try {
        out[p] = text === null ? null : fileToOpml(fileFromOpml(p, text));
      } catch (err) {
        problems.push(`${p}: ${(err as Error).message}`);
      }
    }
    if (problems.length) throw new Error(`Some files on GitHub couldn't be read, so nothing was changed:\n${problems.join("\n")}`);
    for (const [p, f] of Object.entries(base.files)) {
      if (p in out && out[p] !== null) f.text = out[p]!;
      else if (!(p in out)) {
        try {
          f.text = fileToOpml(fileFromOpml(p, f.text));
        } catch {
          /* leave as is */
        }
      }
    }
    return out;
  }

  // ---- Connecting ----------------------------------------------------------

  /** Check a connection before using it. */
  async inspect(conn: Connection): Promise<RepoCheck> {
    const gh = this.gh(conn);
    const info = await gh.repoInfo();
    if (!info.canPush) throw new GitHubError(`This token can't write to ${conn.owner}/${conn.repo}.`, 403);
    const tree = await gh.tree(await gh.head());
    return { hasBlog: "blog.opml" in tree.files, private: info.private };
  }

  /**
   * Connect. If the repo has a blog, it replaces the one in this browser;
   * otherwise this browser's blog is uploaded to it.
   */
  async connect(conn: Connection, check: RepoCheck) {
    const gh = this.gh(conn);
    this.error = "";
    if (check.hasBlog) {
      const r = await pull(gh, null, {});
      const texts = this.normalize(r.base, r.updates) as Record<string, string>;
      this.ws.replaceAll(texts);
      this.base = r.base;
    } else {
      const head = await gh.head();
      const uploads = { ...(await this.ws.starterImageUploads()), ...(await this.ws.imageUploads()) };
      const r = await push(gh, { commit: head, files: {} }, this.ws.texts(), () => "Add blog from Porridge [skip ci]", false, uploads);
      this.base = r.base;
      await this.ws.imagesSaved(Object.keys(uploads));
    }
    this.conn = conn;
    this.isPrivate = check.private;
    this.conflicts = [];
    this.applyImageBase();
    await this.persist();
    this.refresh();
  }

  async disconnect() {
    this.conn = null;
    this.base = null;
    this.build = null;
    this.conflicts = [];
    this.applyImageBase();
    await this.persist();
    this.refresh();
  }

  // ---- Syncing -------------------------------------------------------------

  /** Bring in changes made on GitHub (on startup, or when asked). */
  async check() {
    if (!this.conn || !this.base || this.busy) return;
    this.busy = "checking";
    this.error = "";
    try {
      await this.ws.flush();
      const r = await pull(this.gh(), this.base, this.ws.texts());
      const updates = this.normalize(r.base, r.updates);
      this.ws.applyRemote(updates);
      this.base = r.base;
      this.conflicts = r.conflicts;
      await this.persist();
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.busy = "";
      this.refresh();
    }
  }

  /**
   * Save every change to GitHub in one commit. With `publish`, the commit
   * triggers a build (or, if there's nothing to save, the build workflow is
   * started directly) and the build is followed.
   */
  async save(publish = false, overwrite = false) {
    if (!this.conn || !this.base || this.busy) return;
    this.busy = publish ? "publishing" : "saving";
    this.error = "";
    this.conflictPrompt = null;
    try {
      await this.ws.flush();
      const message = (paths: string[]) => commitMessage(paths, publish);
      const uploads = await this.ws.imageUploads();
      const r = await push(this.gh(), this.base, this.ws.texts(), message, overwrite, uploads);
      const updates = this.normalize(r.base, r.updates);
      this.ws.applyRemote(updates);
      this.base = r.base;
      await this.ws.imagesSaved(Object.keys(uploads));
      this.conflicts = [];
      await this.persist();
      this.refresh();
      if (publish) await this.followBuild(r.commit);
    } catch (err) {
      if (err instanceof ConflictError) {
        this.conflictPrompt = { paths: err.paths, publish };
        this.conflicts = err.paths;
      } else {
        this.error = (err as Error).message;
      }
    } finally {
      this.busy = "";
      this.refresh();
    }
  }

  private async followBuild(commit: string | null) {
    const gh = this.gh();
    let match: { commit: string } | { afterId: number };
    if (commit) {
      match = { commit };
    } else {
      const before = Math.max(0, ...(await gh.runs()).map((r) => r.id));
      await gh.dispatch();
      match = { afterId: before };
    }
    await watchBuild(gh, match, (s) => (this.build = s));
  }

  /** Answer the conflict prompt. */
  async resolve(choice: "mine" | "theirs" | "cancel") {
    const prompt = this.conflictPrompt;
    this.conflictPrompt = null;
    if (!prompt || choice === "cancel") return;
    if (choice === "mine") {
      await this.save(prompt.publish, true);
      return;
    }
    this.busy = "checking";
    try {
      const r = await pull(this.gh(), this.base, this.ws.texts(), prompt.paths);
      this.ws.applyRemote(this.normalize(r.base, r.updates));
      this.base = r.base;
      this.conflicts = r.conflicts;
      await this.persist();
    } catch (err) {
      this.error = (err as Error).message;
      return;
    } finally {
      this.busy = "";
      this.refresh();
    }
    await this.save(prompt.publish);
  }
}

export function commitMessage(paths: string[], publish: boolean): string {
  const images = paths.filter((p) => p.startsWith("images/")).length;
  const names = [
    ...paths.filter((p) => !p.startsWith("images/")).map((p) => p.replace(/^pages\/|\.opml$/g, "")),
    ...(images ? [`${images} image${images === 1 ? "" : "s"}`] : []),
  ].join(", ");
  return `${publish ? "Publish" : "Save"}: ${names}${publish ? "" : " [skip ci]"}`;
}
