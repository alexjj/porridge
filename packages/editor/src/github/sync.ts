// Keeping the browser's copy of the blog and the GitHub repo in step.
//
// The "base" records the commit the browser last synced with and each content
// file's text at that point. Comparing local text with the base tells us what
// changed here; comparing the base's blob sha with the remote's tells us what
// changed on GitHub. A file changed in both places is a conflict.

import { GitHubError, type Change, type GitHub, type RemoteTree } from "./api.js";

export interface Base {
  commit: string;
  files: Record<string, { sha: string; text: string }>;
}

/** Files the editor reads and writes: the blog, its year files and pages. */
export const isContentPath = (p: string): boolean =>
  /^(blog\.opml|blog\/\d{4}\.opml|pages\/[^/]+\.opml)$/.test(p);

export class ConflictError extends Error {
  constructor(readonly paths: string[]) {
    super(`Changed both here and on GitHub: ${paths.join(", ")}`);
    this.name = "ConflictError";
  }
}

/** Paths whose local text differs from the base (added, edited or deleted). */
export function localChanges(base: Base | null, local: Record<string, string>): string[] {
  const paths = new Set([...Object.keys(local), ...Object.keys(base?.files ?? {})]);
  return [...paths].filter((p) => local[p] !== base?.files[p]?.text).sort();
}

export interface PullResult {
  base: Base;
  /** New local contents for files changed only on GitHub (null = deleted). */
  updates: Record<string, string | null>;
  /** Files changed both here and on GitHub; the local copy is kept. */
  conflicts: string[];
}

/**
 * Bring in changes from GitHub. Files edited locally are left alone (and
 * reported as conflicts if GitHub changed them too). `take` lists files where
 * GitHub's version should replace the local one.
 */
export async function pull(
  gh: GitHub,
  base: Base | null,
  local: Record<string, string>,
  take: string[] = [],
  remote?: RemoteTree,
): Promise<PullResult> {
  remote ??= await gh.tree(await gh.head());
  const changedHere = new Set(localChanges(base, local));
  const updates: Record<string, string | null> = {};
  const conflicts: string[] = [];
  const files: Base["files"] = {};

  const paths = new Set([...Object.keys(remote.files).filter(isContentPath), ...Object.keys(base?.files ?? {})]);
  await Promise.all(
    [...paths].map(async (p) => {
      const remoteSha = remote.files[p];
      const old = base?.files[p];
      const changedThere = remoteSha !== old?.sha;
      if (changedHere.has(p) && changedThere && !take.includes(p)) {
        conflicts.push(p);
        if (old) files[p] = old;
        return;
      }
      if (!remoteSha) {
        if (changedThere || take.includes(p)) updates[p] = null;
        return;
      }
      if (changedThere || take.includes(p)) {
        const text = await gh.blobText(remoteSha);
        if (!changedHere.has(p) || take.includes(p)) updates[p] = text;
        files[p] = { sha: remoteSha, text };
      } else {
        files[p] = old!;
      }
    }),
  );
  return { base: { commit: remote.commit, files }, updates, conflicts: conflicts.sort() };
}

export interface PushResult {
  base: Base;
  /** The new commit, or null if there was nothing to save. */
  commit: string | null;
  /** Changes from GitHub brought in at the same time. */
  updates: Record<string, string | null>;
  saved: string[];
}

/**
 * Commit every local change in one commit on top of the branch head. Changes
 * made on GitHub to other files are kept and brought in. If GitHub changed a
 * file that was also changed here, throws ConflictError unless `overwrite`.
 */
export async function push(
  gh: GitHub,
  base: Base,
  local: Record<string, string>,
  message: (paths: string[]) => string,
  overwrite = false,
): Promise<PushResult> {
  for (let attempt = 0; ; attempt++) {
    const remote = await gh.tree(await gh.head());
    const changed = localChanges(base, local);
    const conflicts = changed.filter((p) => remote.files[p] !== base.files[p]?.sha);
    if (conflicts.length && !overwrite) throw new ConflictError(conflicts);

    // Bring the base up to the remote head for everything not changed here.
    const pulled = await pull(gh, base, local, [], remote);
    if (changed.length === 0) return { base: pulled.base, commit: null, updates: pulled.updates, saved: [] };

    const changes: Change[] = changed
      .filter((p) => local[p] !== undefined || remote.files[p])
      .map((p) => ({ path: p, text: local[p] ?? null }));
    const commit = await gh.commit(remote.commit, remote.tree, changes, message(changed));
    try {
      await gh.moveBranch(commit);
    } catch (err) {
      // Someone pushed in between: start again from the new head.
      if (err instanceof GitHubError && err.status === 422 && attempt < 2) continue;
      throw err;
    }
    const after = await gh.tree(commit);
    const files: Base["files"] = {};
    const mine = new Set(changed);
    for (const [p, sha] of Object.entries(after.files)) {
      if (!isContentPath(p)) continue;
      const text = mine.has(p) ? local[p] : p in pulled.updates ? pulled.updates[p] : pulled.base.files[p]?.text;
      if (text !== undefined && text !== null) files[p] = { sha, text };
    }
    return { base: { commit, files }, commit, updates: pulled.updates, saved: changed };
  }
}

export type BuildState =
  | { state: "starting" }
  | { state: "running"; url: string }
  | { state: "done"; ok: boolean; url: string };

/**
 * Follow the build started by a push of `commit`, or by a dispatch made after
 * the run with id `afterId`. Calls `update` as it changes.
 */
export async function watchBuild(
  gh: GitHub,
  match: { commit: string } | { afterId: number },
  update: (s: BuildState) => void,
  opts: { interval?: number; timeout?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<BuildState> {
  const interval = opts.interval ?? 4000;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.timeout ?? 20 * 60_000);
  update({ state: "starting" });
  await sleep(Math.min(1500, interval));
  for (;;) {
    const runs = await gh.runs();
    const run = runs.find((r) =>
      "commit" in match ? r.headSha === match.commit : r.id > match.afterId && r.event === "workflow_dispatch",
    );
    if (run) {
      const s: BuildState =
        run.status === "completed"
          ? { state: "done", ok: run.conclusion === "success", url: run.url }
          : { state: "running", url: run.url };
      update(s);
      if (s.state === "done") return s;
    }
    if (Date.now() > deadline) throw new GitHubError("Gave up waiting for the build to finish.", 0);
    await sleep(interval);
  }
}
