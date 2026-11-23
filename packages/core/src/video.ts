// YouTube videos: a line that's just a YouTube address shows the video.

export interface Video {
  id: string;
  /** Start time in seconds, from `t=` or `start=`. */
  start?: number;
}

const ID = /^[A-Za-z0-9_-]{11}$/;

/** "90", "90s", "1m30s", "1h2m3s" → seconds. */
function seconds(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m || !m[0]) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * The video in a line whose whole text is a YouTube address (optionally in
 * <angle brackets>), or null.
 */
export function parseVideo(text: string): Video | null {
  let t = text.trim();
  if (t.startsWith("<") && t.endsWith(">")) t = t.slice(1, -1);
  if (/\s/.test(t)) return null;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else id = /^\/(?:embed|shorts|live|v)\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
  }
  if (!id || !ID.test(id)) return null;
  const t2 = url.searchParams.get("t") ?? url.searchParams.get("start");
  const start = t2 ? seconds(t2) : 0;
  return start ? { id, start } : { id };
}

export const watchUrl = (v: Video): string =>
  `https://www.youtube.com/watch?v=${v.id}${v.start ? `&t=${v.start}s` : ""}`;

export const thumbnailUrl = (v: Video): string => `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;

/** The player, for the site. Privacy-enhanced (no cookies until played) and lazy-loaded. */
export function videoEmbed(v: Video): string {
  const src = `https://www.youtube-nocookie.com/embed/${v.id}${v.start ? `?start=${v.start}` : ""}`;
  return (
    // width/height tell YouTube the player is large, so it serves a sharp preview image.
    `<span class="video"><iframe src="${src}" width="1280" height="720" title="YouTube video" loading="lazy" ` +
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ` +
    `referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></span>`
  );
}

/** A thumbnail linking to YouTube, for RSS (feed readers drop players). */
export function videoLink(v: Video): string {
  return `<a href="${watchUrl(v).replace(/&/g, "&amp;")}"><img src="${thumbnailUrl(v)}" alt="YouTube video"></a>`;
}

/** A thumbnail with a play badge, for the editor (a player would get in the way of editing). */
export function videoThumbnail(v: Video): string {
  return `<span class="video-thumb"><img src="${thumbnailUrl(v)}" alt="YouTube video"><span class="video-play" aria-hidden="true">▶</span></span>`;
}
