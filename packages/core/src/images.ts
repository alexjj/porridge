// Where images are kept in a blog repo.

/**
 * `images/2026/11/porridge-181930.jpg`: filed by month, named after the
 * original file, with the day and time so names don't collide.
 */
export function imagePath(originalName: string, date: string, time: string, ext: string): string {
  const stem = originalName
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const [y, m, d] = date.split("-");
  return `images/${y}/${m}/${stem || "photo"}-${d}${time}.${ext}`;
}
