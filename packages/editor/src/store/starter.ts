// The starter blog: template/ in this repo, shown when the browser has no
// workspace yet or the user resets it. The editor's own tests build it with
// `--mode e2e` and get a small, fixed blog instead (e2e/starter/), so they
// don't change whenever the starter content does.

const template = import.meta.glob("../../../../template/**/*.opml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const testBlog = import.meta.glob("../../e2e/starter/**/*.opml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The starter's images, bundled with the editor: path in the blog → URL. */
const templateImages = import.meta.glob("../../../../template/images/**/*", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const relative = (files: Record<string, string>, marker: string) =>
  Object.fromEntries(Object.entries(files).map(([path, value]) => [path.slice(path.indexOf(marker) + marker.length), value]));

const testing = import.meta.env.MODE === "e2e";

export const STARTER: Record<string, string> = testing ? relative(testBlog, "/starter/") : relative(template, "/template/");

/**
 * Images the starter blog uses, so they show before a repository is
 * connected, and can be uploaded to an empty one.
 */
export const STARTER_IMAGES: Record<string, string> = testing ? {} : relative(templateImages, "/template/");
