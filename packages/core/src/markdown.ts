// Inline Markdown for node text.

import MarkdownIt from "markdown-it";
import { parseVideo, videoEmbed, videoLink, videoThumbnail } from "./video.js";

/**
 * How a line that's just a YouTube address shows: the player (site), a
 * linked thumbnail (RSS), or a thumbnail (editor).
 */
export type VideoStyle = "embed" | "link" | "thumbnail";

export interface InlineRenderer {
  /** Render a node's text to inline HTML. */
  html(text: string): string;
  /** The node's text with Markdown removed (for <title> and RSS titles). */
  plain(text: string): string;
}

/**
 * Root-relative URLs (`/images/x.jpg`) in links and images (and in `src`,
 * `poster` and `href` in inline HTML) are rewritten to
 * start with `urlPrefix`: the site's base path for pages, its full base URL
 * for RSS. Images can use a different prefix (the editor loads them from the
 * repo).
 */
export function createInlineRenderer(urlPrefix: string, imagePrefix = urlPrefix, video: VideoStyle = "embed"): InlineRenderer {
  const showVideo = { embed: videoEmbed, link: videoLink, thumbnail: videoThumbnail }[video];
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false });
  const rewriteWith = (prefix: string) => (url: string) =>
    url.startsWith("/") && !url.startsWith("//") ? prefix + url.slice(1) : url;
  const rewrite = rewriteWith(urlPrefix);
  const rewriteImage = rewriteWith(imagePrefix);

  // An image's description is shown as a caption underneath it. The caption is
  // hidden from screen readers, which already read the alt text.
  const renderImage = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const img = renderImage(tokens, idx, options, env, self);
    const alt = self.renderInlineAsText(tokens[idx]!.children ?? [], options, env).trim();
    if (!alt) return img;
    return `<span class="figure">${img}<span class="caption" aria-hidden="true">${md.utils.escapeHtml(alt)}</span></span>`;
  };

  md.core.ruler.push("porridge_urls", (state) => {
    for (const token of state.tokens) {
      for (const child of token.children ?? []) {
        if (child.type === "link_open") {
          const href = child.attrGet("href");
          if (href) child.attrSet("href", rewrite(String(href)));
        } else if (child.type === "image") {
          const src = child.attrGet("src");
          if (src) child.attrSet("src", rewriteImage(String(src)));
        } else if (child.type === "html_inline") {
          // HTML such as <video src="/images/…">: media like images, links like links.
          child.content = child.content
            .replace(/\b(src|poster)="(\/[^"]*)"/g, (_m, a: string, u: string) => `${a}="${rewriteImage(u)}"`)
            .replace(/\bhref="(\/[^"]*)"/g, (_m, u: string) => `href="${rewrite(u)}"`);
        }
      }
    }
  });

  return {
    html: (text) => {
      const v = parseVideo(text);
      return v ? showVideo(v) : md.renderInline(text);
    },
    plain: (text) => {
      const [inline] = md.parseInline(text, {});
      let out = "";
      for (const t of inline?.children ?? []) {
        if (t.type === "text" || t.type === "code_inline") out += t.content;
        else if (t.type === "image") out += t.content;
        else if (t.type === "softbreak" || t.type === "hardbreak") out += " ";
      }
      return out.trim();
    },
  };
}
