// The starter blog (template/ in this repo), used when the browser has no
// workspace yet or the user resets it.

const raw = import.meta.glob("../../../../template/**/*.opml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const STARTER: Record<string, string> = Object.fromEntries(
  Object.entries(raw).map(([path, text]) => [path.replace(/^.*\/template\//, ""), text]),
);
