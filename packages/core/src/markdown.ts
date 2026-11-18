// Inline Markdown for node text.

import MarkdownIt from "markdown-it";

export interface InlineRenderer {
  /** Render a node's text to inline HTML. */
  html(text: string): string;
  /** The node's text with Markdown removed (for <title> and RSS titles). */
  plain(text: string): string;
}

/**
 * Root-relative URLs (`/images/x.jpg`) in links and images are rewritten to
 * start with `urlPrefix`: the site's base path for pages, its full base URL
 * for RSS.
 */
export function createInlineRenderer(urlPrefix: string): InlineRenderer {
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false });
  const rewrite = (url: string) =>
    url.startsWith("/") && !url.startsWith("//") ? urlPrefix + url.slice(1) : url;

  md.core.ruler.push("porridge_urls", (state) => {
    for (const token of state.tokens) {
      for (const child of token.children ?? []) {
        if (child.type === "link_open") {
          const href = child.attrGet("href");
          if (href) child.attrSet("href", rewrite(String(href)));
        } else if (child.type === "image") {
          const src = child.attrGet("src");
          if (src) child.attrSet("src", rewrite(String(src)));
        }
      }
    }
  });

  return {
    html: (text) => md.renderInline(text),
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
