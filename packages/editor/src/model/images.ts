// Preparing photos for the blog: sizing, format and file names.

/** Longest edge of an uploaded image, in pixels. */
export const MAX_EDGE = 2000;
/** Originals larger than this are never kept as they are. */
export const MAX_BYTES = 700_000;
/** WebP quality: visually close to the original at a fraction of the size. */
export const WEBP_QUALITY = 0.82;

const KEEP_AS_IS = ["image/gif", "image/svg+xml"];
const WEB_FORMATS = ["image/jpeg", "image/png", "image/webp"];

export function targetSize(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** GIFs (which may be animated) and SVGs are uploaded exactly as they are. */
export const keepAsIs = (type: string): boolean => KEEP_AS_IS.includes(type);

/**
 * Everything else is re-encoded as WebP. Keep the original instead only if
 * it's already a web format, small enough, and no bigger than the WebP.
 */
export function preferOriginal(type: string, bytes: number, width: number, height: number, encodedBytes: number): boolean {
  return WEB_FORMATS.includes(type) && Math.max(width, height) <= MAX_EDGE && bytes <= MAX_BYTES && bytes <= encodedBytes;
}

export function extensionFor(type: string): string {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" }[type] ?? "jpg";
}

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

/** Alt text suggestion from a file name: "IMG_2041.jpg" → "", "porridge-bowl.png" → "porridge bowl". */
export function suggestAlt(originalName: string): string {
  const stem = originalName.replace(/\.[^.]*$/, "").replace(/[-_]+/g, " ").trim();
  return /^(img|dsc|pxl|photo|image|screenshot)?\s*[\d\s]*$/i.test(stem) ? "" : stem;
}
