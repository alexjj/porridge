import { describe, expect, it } from "vitest";
import { GitHub, GitHubError, parseRepo, type Connection } from "../src/github/api.js";
import { ConflictError, localChanges, pull, push, watchBuild, type Base, type BuildState } from "../src/github/sync.js";
import { FakeGitHub } from "./fake-github.js";

const conn = (over: Partial<Connection> = {}): Connection => ({
  owner: "me",
  repo: "blog",
  branch: "main",
  token: "good-token",
  workflow: "build.yml",
  ...over,
});

const START = {
  "blog.opml": "<blog/>",
  "blog/2026.opml": "<y2026/>",
  "pages/about.opml": "<about/>",
  "images/2026/11/cat.jpg": "binary",
  ".github/workflows/build.yml": "on: push",
};

async function setup() {
  const fake = new FakeGitHub(START);
  const gh = new GitHub(conn(), fake.fetch);
  const first = await pull(gh, null, {});
  const local: Record<string, string> = { ...(first.updates as Record<string, string>) };
  return { fake, gh, base: first.base, local };
}

const msg = (paths: string[]) => `Save ${paths.join(", ")} [skip ci]`;

describe("connecting", () => {
  it("parses repository names and URLs", () => {
    expect(parseRepo("me/blog")).toEqual({ owner: "me", repo: "blog" });
    expect(parseRepo("https://github.com/me/my.blog.git")).toEqual({ owner: "me", repo: "my.blog" });
    expect(parseRepo("not a repo")).toBeUndefined();
  });

  it("explains auth and not-found errors", async () => {
    const fake = new FakeGitHub(START);
    await expect(new GitHub(conn({ token: "bad" }), fake.fetch).head()).rejects.toThrow(/didn't accept the token/);
    await expect(new GitHub(conn({ branch: "nope" }), fake.fetch).head()).rejects.toThrow(/Not found/);
    await expect(new GitHub(conn(), new FakeGitHub().fetch).head()).rejects.toThrow(/empty/);
  });

  it("first pull loads only content files", async () => {
    const { local, base, fake } = await setup();
    expect(Object.keys(local).sort()).toEqual(["blog.opml", "blog/2026.opml", "pages/about.opml"]);
    expect(base.commit).toBe(fake.head());
    expect(localChanges(base, local)).toEqual([]);
  });
});

describe("saving", () => {
  it("commits all local changes in one commit, including new and deleted files", async () => {
    const { fake, gh, base, local } = await setup();
    local["blog/2026.opml"] = "<y2026 edited/>";
    local["pages/now.opml"] = "<now/>";
    delete local["pages/about.opml"];
    expect(localChanges(base, local)).toEqual(["blog/2026.opml", "pages/about.opml", "pages/now.opml"]);

    const r = await push(gh, base, local, msg);
    expect(r.saved).toEqual(["blog/2026.opml", "pages/about.opml", "pages/now.opml"]);
    expect(fake.commitCount()).toBe(2);
    expect(fake.lastMessage()).toBe("Save blog/2026.opml, pages/about.opml, pages/now.opml [skip ci]");
    expect(fake.read("blog/2026.opml")).toBe("<y2026 edited/>");
    expect(fake.read("pages/now.opml")).toBe("<now/>");
    expect(fake.read("pages/about.opml")).toBeUndefined();
    // Other files are untouched.
    expect(fake.read("images/2026/11/cat.jpg")).toBe("binary");
    expect(localChanges(r.base, local)).toEqual([]);
    // [skip ci] means no build.
    expect(fake.runs).toEqual([]);
  });

  it("does nothing when there's nothing to save", async () => {
    const { fake, gh, base, local } = await setup();
    const r = await push(gh, base, local, msg);
    expect(r.commit).toBeNull();
    expect(fake.commitCount()).toBe(1);
  });

  it("keeps changes made on GitHub to other files, and brings them in", async () => {
    const { fake, gh, base, local } = await setup();
    fake.commitRemote({ "pages/about.opml": "<about from phone/>", "images/new.jpg": "img" });
    local["blog/2026.opml"] = "<y2026 edited/>";

    const r = await push(gh, base, local, msg);
    expect(r.updates).toEqual({ "pages/about.opml": "<about from phone/>" });
    expect(fake.read("pages/about.opml")).toBe("<about from phone/>");
    expect(fake.read("blog/2026.opml")).toBe("<y2026 edited/>");
    expect(fake.read("images/new.jpg")).toBe("img");
    Object.assign(local, r.updates);
    expect(localChanges(r.base, local)).toEqual([]);
  });

  it("refuses to overwrite a file changed in both places, unless asked", async () => {
    const { fake, gh, base, local } = await setup();
    fake.commitRemote({ "blog/2026.opml": "<y2026 from phone/>" });
    local["blog/2026.opml"] = "<y2026 from laptop/>";

    const err = await push(gh, base, local, msg).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).paths).toEqual(["blog/2026.opml"]);
    expect(fake.read("blog/2026.opml")).toBe("<y2026 from phone/>");

    await push(gh, base, local, msg, true);
    expect(fake.read("blog/2026.opml")).toBe("<y2026 from laptop/>");
    expect(fake.commitCount()).toBe(3); // history kept, not force-pushed
  });

  it("starts again if someone pushes between commit and branch update", async () => {
    const { fake, gh, base, local } = await setup();
    local["blog/2026.opml"] = "<mine/>";
    const realMove = gh.moveBranch.bind(gh);
    let raced = false;
    gh.moveBranch = async (sha) => {
      if (!raced) {
        raced = true;
        fake.commitRemote({ "pages/about.opml": "<sneaky/>" });
      }
      return realMove(sha);
    };
    const r = await push(gh, base, local, msg);
    expect(fake.read("blog/2026.opml")).toBe("<mine/>");
    expect(fake.read("pages/about.opml")).toBe("<sneaky/>");
    expect(r.updates).toEqual({ "pages/about.opml": "<sneaky/>" });
  });
});

describe("pulling", () => {
  it("brings in remote changes to files not edited here", async () => {
    const { fake, gh, base, local } = await setup();
    fake.commitRemote({ "pages/about.opml": "<about v2/>", "pages/new.opml": "<new/>", "blog/2026.opml": null });
    const r = await pull(gh, base, local);
    expect(r.updates).toEqual({ "pages/about.opml": "<about v2/>", "pages/new.opml": "<new/>", "blog/2026.opml": null });
    expect(r.conflicts).toEqual([]);
  });

  it("keeps local edits and reports conflicts", async () => {
    const { fake, gh, base, local } = await setup();
    fake.commitRemote({ "blog/2026.opml": "<theirs/>", "pages/about.opml": "<about v2/>" });
    local["blog/2026.opml"] = "<mine/>";
    const r = await pull(gh, base, local);
    expect(r.updates).toEqual({ "pages/about.opml": "<about v2/>" });
    expect(r.conflicts).toEqual(["blog/2026.opml"]);
    // The conflict is still detected when saving later.
    Object.assign(local, r.updates);
    await expect(push(gh, r.base, local, msg)).rejects.toBeInstanceOf(ConflictError);
  });

  it("can take GitHub's version of conflicting files", async () => {
    const { fake, gh, base, local } = await setup();
    fake.commitRemote({ "blog/2026.opml": "<theirs/>" });
    local["blog/2026.opml"] = "<mine/>";
    const r = await pull(gh, base, local, ["blog/2026.opml"]);
    expect(r.updates).toEqual({ "blog/2026.opml": "<theirs/>" });
    expect(r.conflicts).toEqual([]);
    expect(localChanges(r.base, { ...local, ...(r.updates as Record<string, string>) })).toEqual([]);
  });
});

describe("publishing", () => {
  const fast = { interval: 1, sleep: async () => {} };

  it("follows the build started by a push", async () => {
    const { fake, gh, base, local } = await setup();
    fake.buildPolls = 2;
    local["blog/2026.opml"] = "<publish me/>";
    const r = await push(gh, base, local, () => "Publish");
    const states: BuildState[] = [];
    const done = await watchBuild(gh, { commit: r.commit! }, (s) => states.push(s), fast);
    expect(states.map((s) => s.state)).toEqual(["starting", "running", "done"]);
    expect(done).toEqual({ state: "done", ok: true, url: "https://github.com/me/blog/actions/runs/1" });
  });

  it("follows a dispatched build and reports failure", async () => {
    const { fake, gh } = await setup();
    fake.commitRemote({ "x.txt": "x" }); // run 1, a push
    fake.failBuilds = true;
    const before = Math.max(0, ...(await gh.runs()).map((r) => r.id));
    await gh.dispatch();
    const done = await watchBuild(gh, { afterId: before }, () => {}, fast);
    expect(done).toEqual({ state: "done", ok: false, url: "https://github.com/me/blog/actions/runs/2" });
  });

  it("reports a missing workflow", async () => {
    const fake = new FakeGitHub(START);
    const gh = new GitHub(conn({ workflow: "nope.yml" }), fake.fetch);
    await expect(gh.dispatch()).rejects.toBeInstanceOf(GitHubError);
  });
});

it("base type is plain data (stored in IndexedDB)", async () => {
  const { base } = await setup();
  const copy: Base = structuredClone(base);
  expect(copy).toEqual(base);
});
