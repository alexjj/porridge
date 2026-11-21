// Copying lines out of the editor, and reading pasted lists back in.

import type { ENode } from "./tree.js";
import type { PastedLine } from "./ops.js";

/** Lines as an indented Markdown list: "- line", two spaces per level. */
export function outlineToText(nodes: ENode[], depth = 0): string {
  return nodes
    .map((n) => `${"  ".repeat(depth)}- ${n.text}\n${outlineToText(n.children, depth + 1)}`)
    .join("");
}

/** Lines as a nested HTML list, each line's Markdown rendered by `html`. */
export function outlineToHtml(nodes: ENode[], html: (text: string) => string): string {
  if (!nodes.length) return "";
  const items = nodes.map((n) => `<li>${html(n.text)}${outlineToHtml(n.children, html)}</li>`);
  return `<ul>${items.join("")}</ul>`;
}

const MARKER = /^[-*+•]\s+/;

/**
 * Read pasted text as lines with depths, from its indentation (tabs count as
 * four spaces) and any "- " / "* " / "• " list markers, which are dropped.
 * Blank lines are skipped.
 */
export function parsePastedText(text: string): PastedLine[] {
  const raw = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const lead = /^[ \t]*/.exec(l)![0];
      const width = lead.replace(/\t/g, "    ").length;
      return { width, text: l.trim().replace(MARKER, "") };
    });
  // Each distinct indentation is one level deeper than the one before.
  const widths = [...new Set(raw.map((l) => l.width))].sort((a, b) => a - b);
  return raw.map((l) => ({ text: l.text, depth: widths.indexOf(l.width) }));
}
