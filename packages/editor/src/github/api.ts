// The small part of the GitHub REST API the editor uses. Everything goes
// straight from the browser to api.github.com with the user's token.

export interface Connection {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  /** Workflow file that builds the site, e.g. "build.yml". */
  workflow: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface RepoInfo {
  defaultBranch: string;
  canPush: boolean;
  private: boolean;
}

export interface RemoteTree {
  commit: string;
  tree: string;
  /** Blob sha of every file, by path. */
  files: Record<string, string>;
}

export type Change =
  | {
      path: string;
      /** New text contents, or null to delete. */
      text: string | null;
    }
  | {
      path: string;
      /** Binary contents (an image), base64 encoded. */
      base64: string;
    };

export interface Run {
  id: number;
  headSha: string;
  event: string;
  status: string;
  conclusion: string | null;
  url: string;
}

type Fetch = typeof fetch;

const seg = (s: string) => s.split("/").map(encodeURIComponent).join("/");

export class GitHub {
  constructor(
    readonly conn: Connection,
    private readonly fetchFn: Fetch = (...args) => fetch(...args),
  ) {}

  private async request(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<Response> {
    const { owner, repo, token } = this.conn;
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        ...init,
        headers: {
          Accept: init.raw ? "application/vnd.github.raw" : "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      throw new GitHubError("Couldn't reach GitHub. Check your connection.", 0);
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = ((await res.json()) as { message?: string }).message ?? "";
      } catch {
        /* not JSON */
      }
      throw new GitHubError(describe(res.status, detail), res.status);
    }
    return res;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await this.request(path, init)).json() as Promise<T>;
  }

  async repoInfo(): Promise<RepoInfo> {
    const r = await this.json<{ default_branch: string; private: boolean; permissions?: { push?: boolean } }>("");
    return { defaultBranch: r.default_branch, canPush: !!r.permissions?.push, private: r.private };
  }

  /** Commit sha at the head of the branch. */
  async head(): Promise<string> {
    const r = await this.json<{ object: { sha: string } }>(`/git/ref/heads/${seg(this.conn.branch)}`);
    return r.object.sha;
  }

  async tree(commit: string): Promise<RemoteTree> {
    const c = await this.json<{ tree: { sha: string } }>(`/git/commits/${commit}`);
    const t = await this.json<{ tree: { path: string; type: string; sha: string }[]; truncated: boolean }>(
      `/git/trees/${c.tree.sha}?recursive=1`,
    );
    if (t.truncated) throw new GitHubError("This repository has too many files for the editor to list.", 0);
    const files: Record<string, string> = {};
    for (const e of t.tree) if (e.type === "blob") files[e.path] = e.sha;
    return { commit, tree: c.tree.sha, files };
  }

  async blobText(sha: string): Promise<string> {
    return (await this.request(`/git/blobs/${sha}`, { raw: true })).text();
  }

  /** Create a commit on top of `parent` (whose tree is `baseTree`). Doesn't move the branch. */
  async commit(parent: string, baseTree: string, changes: Change[], message: string): Promise<string> {
    // Text goes inline in the tree; binary files have to be created as blobs first.
    const entries = await Promise.all(
      changes.map(async (c) => {
        if ("base64" in c) {
          const blob = await this.json<{ sha: string }>("/git/blobs", {
            method: "POST",
            body: JSON.stringify({ content: c.base64, encoding: "base64" }),
          });
          return { path: c.path, mode: "100644", type: "blob", sha: blob.sha };
        }
        return c.text === null
          ? { path: c.path, mode: "100644", type: "blob", sha: null }
          : { path: c.path, mode: "100644", type: "blob", content: c.text };
      }),
    );
    const tree = await this.json<{ sha: string }>("/git/trees", {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTree, tree: entries }),
    });
    const commit = await this.json<{ sha: string }>("/git/commits", {
      method: "POST",
      body: JSON.stringify({ message, tree: tree.sha, parents: [parent] }),
    });
    return commit.sha;
  }

  /** Move the branch to `sha`. Fails with status 422 if that isn't a fast-forward. */
  async moveBranch(sha: string): Promise<void> {
    await this.request(`/git/refs/heads/${seg(this.conn.branch)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha, force: false }),
    });
  }

  async dispatch(): Promise<void> {
    await this.request(`/actions/workflows/${encodeURIComponent(this.conn.workflow)}/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: this.conn.branch }),
    });
  }

  async runs(): Promise<Run[]> {
    const r = await this.json<{
      workflow_runs: { id: number; head_sha: string; event: string; status: string; conclusion: string | null; html_url: string }[];
    }>(`/actions/workflows/${encodeURIComponent(this.conn.workflow)}/runs?branch=${encodeURIComponent(this.conn.branch)}&per_page=10`);
    return r.workflow_runs.map((w) => ({
      id: w.id,
      headSha: w.head_sha,
      event: w.event,
      status: w.status,
      conclusion: w.conclusion,
      url: w.html_url,
    }));
  }
}

function describe(status: number, detail: string): string {
  switch (status) {
    case 401:
      return "GitHub didn't accept the token. It may be mistyped or expired.";
    case 403:
      return `GitHub refused the request${detail ? `: ${detail}` : ""}. Check the token's permissions.`;
    case 404:
      return "Not found on GitHub. Check the repository, branch and workflow names, and that the token can access the repository.";
    case 409:
      return "The repository is empty. Create it from the porridge template first.";
    default:
      return `GitHub error ${status}${detail ? `: ${detail}` : ""}.`;
  }
}

/** The repository's default GitHub Pages address. */
export function pagesUrl(conn: Pick<Connection, "owner" | "repo">): string {
  const host = `${conn.owner.toLowerCase()}.github.io`;
  return conn.repo.toLowerCase() === host ? `https://${host}/` : `https://${host}/${conn.repo}/`;
}

/** URL prefix for loading files in the repo directly (public repositories only). */
export function rawBase(conn: Connection): string {
  return `https://raw.githubusercontent.com/${conn.owner}/${conn.repo}/${seg(conn.branch)}/`;
}

/** Accepts "owner/repo" or a github.com URL. */
export function parseRepo(input: string): { owner: string; repo: string } | undefined {
  const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(input.trim());
  return m ? { owner: m[1]!, repo: m[2]! } : undefined;
}
