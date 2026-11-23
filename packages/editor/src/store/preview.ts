// Live preview: renders the page being edited with the same code as the
// published site.

import { loadSite, PorridgeError, renderSite, siteStylesheet, STYLESHEET, type ContentSource } from "@porridge/core";
import { dayOf } from "../model/calendar.js";
import { isYearFile, type EFile } from "../model/tree.js";

export interface Preview {
  html: string;
  /** What's being shown, e.g. "Wednesday 18th November 2026". */
  label: string;
  warnings: string[];
}

function memorySource(texts: Record<string, string>): ContentSource {
  return {
    read: async (path) => texts[path],
    list: async (dir) =>
      Object.keys(texts)
        .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/"))
        .map((p) => p.slice(dir.length + 1)),
  };
}

/**
 * Which output page to show: the day being edited, the page being edited, or
 * the home page.
 */
function target(file: EFile | undefined, nodeId: string | null): { path: string; fallback: string } {
  if (file && isYearFile(file.path)) {
    const date = nodeId ? dayOf(file, nodeId) : undefined;
    if (date) return { path: `${date.replace(/-/g, "/")}/index.html`, fallback: "index.html" };
  }
  if (file?.path.startsWith("pages/")) {
    return { path: `${file.path.slice(6, -5)}/index.html`, fallback: "" };
  }
  return { path: "index.html", fallback: "index.html" };
}

export async function renderPreview(
  texts: Record<string, string>,
  file: EFile | undefined,
  nodeId: string | null,
  imageBase = "/",
  /** Images to show from the browser rather than the repo: path → URL. */
  localImages: Record<string, string> = {},
): Promise<Preview> {
  try {
    // Root-relative links resolve against "/" in the preview.
    const site = await loadSite(memorySource(texts), { baseUrl: "https://preview.invalid/" });
    const out = renderSite(site);
    const { path, fallback } = target(file, nodeId);
    const page = out.find((f) => f.path === path) ?? out.find((f) => f.path === fallback);
    if (!page) {
      return { html: message("This page isn't published (it may be a draft or have an invalid name)."), label: "", warnings: [] };
    }
    const html = page.content
      .replace(/<link rel="stylesheet"[^>]*>/, `<style>${siteStylesheet(site)}\na { pointer-events: none; }</style>`)
      .replace(/<header class="site-header">[\s\S]*?<\/header>/, "")
      // The preview is sandboxed, so a video player couldn't run: show its thumbnail.
      .replace(
        /<span class="video"><iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/([\w-]{11})[^"]*"[^>]*><\/iframe><\/span>/g,
        (_m, id: string) => `<span class="video"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="YouTube video"></span>`,
      )
      // Images live in the browser (not uploaded yet) or in the repo, not at the preview's address.
      .replace(/src="\/(images\/[^"]+)"/g, (m, path: string) =>
        localImages[path] ? `src="${localImages[path]}"` : `src="${imageBase}${path}"`,
      );
    const label = /<title>([^<]*)<\/title>/.exec(page.content)?.[1]?.split(" – ")[0] ?? "";
    return { html, label: label || "Home page", warnings: site.warnings.map((w) => `${w.file}: ${w.message}`) };
  } catch (err) {
    const msg = err instanceof PorridgeError ? `${err.file ? `${err.file}: ` : ""}${err.message}` : String(err);
    return { html: message(msg), label: "Can't build", warnings: [] };
  }
}

function message(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html><style>${STYLESHEET}</style><main><p class="empty">${esc}</p></main>`;
}
