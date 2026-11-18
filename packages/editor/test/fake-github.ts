// An in-memory stand-in for the parts of the GitHub API the editor uses: a
// tiny git object store, one branch ref, and workflow runs. Used by the unit
// tests (as a fetch function) and the Playwright tests (via page.route).

import { createHash } from "node:crypto";

interface Commit {
  tree: string;
  parents: string[];
  message: string;
}

interface FakeRun {
  id: number;
  head_sha: string;
  event: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  polls: number;
}

export interface FakeRequest {
  method: string;
  path: string;
  body?: unknown;
}

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

export class FakeGitHub {
  owner = "me";
  repo = "blog";
  branch = "main";
  token = "good-token";
  workflows = new Set(["build.yml"]);
  isPrivate = false;
  canPush = true;
  /** How many polls a build takes to finish. */
  buildPolls = 1;
  failBuilds = false;

  blobs = new Map<string, string>();
  private binary = new Map<string, boolean>();
  trees = new Map<string, Record<string, string>>();
  commits = new Map<string, Commit>();
  refs = new Map<string, string>();
  runs: FakeRun[] = [];
  requests: FakeRequest[] = [];
  private seq = 0;

  constructor(files?: Record<string, string>) {
    if (files) {
      this.commitRemote(files, "Initial commit");
      this.runs = []; // setting up the repo isn't a push anyone is watching
    }
  }

  // ---- Test helpers --------------------------------------------------------

  /** Commit as if from somewhere else. `null` deletes a file. */
  commitRemote(changes: Record<string, string | null>, message = "Changed on GitHub"): string {
    const head = this.refs.get(this.branch);
    const files = { ...(head ? this.trees.get(this.commits.get(head)!.tree)! : {}) };
    for (const [p, text] of Object.entries(changes)) {
      if (text === null) delete files[p];
      else files[p] = this.putBlob(text);
    }
    const commit = this.putCommit({ tree: this.putTree(files), parents: head ? [head] : [], message });
    this.moveRef(commit);
    return commit;
  }

  head(): string {
    return this.refs.get(this.branch)!;
  }

  /** File text at the branch head. */
  read(path: string): string | undefined {
    const sha = this.trees.get(this.commits.get(this.head())!.tree)![path];
    return sha ? this.blobs.get(sha) : undefined;
  }

  /** Bytes of a file at the branch head. */
  readBytes(path: string): Buffer | undefined {
    const sha = this.trees.get(this.commits.get(this.head())!.tree)![path];
    if (!sha) return undefined;
    return Buffer.from(this.blobs.get(sha)!, this.binary.get(sha) ? "latin1" : "utf8");
  }

  paths(): string[] {
    return Object.keys(this.trees.get(this.commits.get(this.head())!.tree)!).sort();
  }

  lastMessage(): string {
    return this.commits.get(this.head())!.message;
  }

  commitCount(): number {
    let n = 0;
    for (let c: string | undefined = this.head(); c; c = this.commits.get(c)!.parents[0]) n++;
    return n;
  }

  /** A fetch function backed by this fake. */
  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const r = this.handle(String(input), init.method ?? "GET", init.headers as Record<string, string>, init.body as string | undefined);
    return new Response(r.body, { status: r.status, headers: r.headers });
  };

  // ---- Request handling ------------------------------------------------------

  handle(
    url: string,
    method: string,
    headers: Record<string, string> = {},
    rawBody?: string,
  ): { status: number; body: string | null; headers: Record<string, string> } {
    const json = (status: number, data: unknown) => ({
      status,
      body: JSON.stringify(data),
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    });
    const fail = (status: number, message: string) => json(status, { message });

    const u = new URL(url);
    const prefix = `/repos/${this.owner}/${this.repo}`;
    if (!u.pathname.startsWith(prefix)) return fail(404, "Not Found");
    const path = decodeURIComponent(u.pathname.slice(prefix.length));
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : undefined;
    this.requests.push({ method, path, body });

    const auth = Object.entries(headers).find(([k]) => k.toLowerCase() === "authorization")?.[1];
    if (auth !== `Bearer ${this.token}`) return fail(401, "Bad credentials");

    let m: RegExpExecArray | null;
    if (method === "GET" && path === "") {
      return json(200, { default_branch: this.branch, private: this.isPrivate, permissions: { push: this.canPush } });
    }
    if (method === "GET" && (m = /^\/git\/ref\/heads\/(.+)$/.exec(path))) {
      if (this.refs.size === 0) return fail(409, "Git Repository is empty.");
      const sha = this.refs.get(m[1]!);
      return sha ? json(200, { object: { sha } }) : fail(404, "Not Found");
    }
    if (method === "GET" && (m = /^\/git\/commits\/(\w+)$/.exec(path))) {
      const c = this.commits.get(m[1]!);
      return c ? json(200, { sha: m[1], tree: { sha: c.tree }, message: c.message }) : fail(404, "Not Found");
    }
    if (method === "GET" && (m = /^\/git\/trees\/(\w+)$/.exec(path))) {
      const t = this.trees.get(m[1]!);
      if (!t) return fail(404, "Not Found");
      return json(200, {
        sha: m[1],
        truncated: false,
        tree: Object.entries(t).map(([p, sha]) => ({ path: p, type: "blob", mode: "100644", sha })),
      });
    }
    if (method === "GET" && (m = /^\/git\/blobs\/(\w+)$/.exec(path))) {
      const text = this.blobs.get(m[1]!);
      if (text === undefined) return fail(404, "Not Found");
      return { status: 200, body: text, headers: { "content-type": "application/vnd.github.raw", "access-control-allow-origin": "*" } };
    }
    if (method === "POST" && path === "/git/blobs") {
      if (body!.encoding !== "base64") return fail(422, "Only base64 blobs are faked");
      return json(201, { sha: this.putBlob(Buffer.from(body!.content as string, "base64").toString("latin1"), "latin1") });
    }
    if (method === "POST" && path === "/git/trees") {
      const base = body!.base_tree ? this.trees.get(body!.base_tree as string) : {};
      if (!base) return fail(422, "base_tree not found");
      const files = { ...base };
      for (const e of body!.tree as { path: string; sha?: string | null; content?: string }[]) {
        if (e.sha === null) {
          if (!files[e.path]) return fail(422, `Path ${e.path} not in tree`);
          delete files[e.path];
        } else if (e.content !== undefined) {
          files[e.path] = this.putBlob(e.content);
        } else if (e.sha) {
          if (!this.blobs.has(e.sha)) return fail(422, `Blob ${e.sha} not found`);
          files[e.path] = e.sha;
        }
      }
      return json(201, { sha: this.putTree(files) });
    }
    if (method === "POST" && path === "/git/commits") {
      const sha = this.putCommit({ tree: body!.tree as string, parents: body!.parents as string[], message: body!.message as string });
      return json(201, { sha });
    }
    if (method === "PATCH" && (m = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
      const sha = body!.sha as string;
      const current = this.refs.get(m[1]!);
      if (!body!.force && current && !this.commits.get(sha)?.parents.includes(current)) {
        return fail(422, "Update is not a fast forward");
      }
      this.moveRef(sha);
      return json(200, { object: { sha } });
    }
    if (method === "POST" && (m = /^\/actions\/workflows\/([^/]+)\/dispatches$/.exec(path))) {
      if (!this.workflows.has(m[1]!)) return fail(404, "Not Found");
      this.startRun(this.head(), "workflow_dispatch");
      return { status: 204, body: null, headers: { "access-control-allow-origin": "*" } };
    }
    if (method === "GET" && (m = /^\/actions\/workflows\/([^/]+)\/runs$/.exec(path))) {
      if (!this.workflows.has(m[1]!)) return fail(404, "Not Found");
      for (const r of this.runs) {
        if (r.status === "completed") continue;
        r.polls++;
        if (r.polls >= this.buildPolls) {
          r.status = "completed";
          r.conclusion = this.failBuilds ? "failure" : "success";
        } else {
          r.status = "in_progress";
        }
      }
      const workflow_runs = [...this.runs].reverse().map(({ polls: _, ...r }) => r);
      return json(200, { total_count: workflow_runs.length, workflow_runs });
    }
    return fail(404, `Fake GitHub doesn't handle ${method} ${path}`);
  }

  // ---- Internals -------------------------------------------------------------

  /** Stores text as UTF-8, or binary data held in a latin1 string. */
  private putBlob(text: string, encoding: "utf8" | "latin1" = "utf8"): string {
    const bytes = Buffer.from(text, encoding);
    const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    this.blobs.set(sha, text);
    this.binary.set(sha, encoding === "latin1");
    return sha;
  }

  private putTree(files: Record<string, string>): string {
    const sha = sha1(`tree ${JSON.stringify(Object.entries(files).sort())}`);
    this.trees.set(sha, files);
    return sha;
  }

  private putCommit(c: Commit): string {
    const sha = sha1(`commit ${++this.seq} ${JSON.stringify(c)}`);
    this.commits.set(sha, c);
    return sha;
  }

  private moveRef(sha: string) {
    this.refs.set(this.branch, sha);
    if (!this.commits.get(sha)!.message.includes("[skip ci]")) this.startRun(sha, "push");
  }

  private startRun(sha: string, event: string) {
    const id = this.runs.length + 1;
    this.runs.push({
      id,
      head_sha: sha,
      event,
      status: "queued",
      conclusion: null,
      html_url: `https://github.com/${this.owner}/${this.repo}/actions/runs/${id}`,
      polls: 0,
    });
  }
}
