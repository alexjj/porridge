// The site's icon (favicon): one emoji, drawn as an SVG.

export const DEFAULT_ICON = "🥣";

/** Emoji offered in Blog settings (any other single emoji works too). */
export const ICON_CHOICES = [
  "🥣", "☕", "🍵", "🍞", "🍎", "🌱", "🌿", "🌻",
  "🌙", "☀️", "🌊", "⛰️", "🚲", "🐈", "🐕", "🦉",
  "🐝", "📝", "📓", "📚", "✏️", "📷", "🎨", "🎵",
  "🧭", "✨", "🔥", "❤️",
];

/** Why `value` can't be the icon (it must be one emoji or character), or undefined. */
export function iconProblem(value: string): string | undefined {
  const v = value.trim();
  if (!v) return "it's empty";
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(v)];
  if (graphemes.length !== 1) return `"${v}" isn't a single emoji`;
  return undefined;
}

/** An SVG favicon showing the emoji. */
export function faviconSvg(icon: string): string {
  const text = icon.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="50" dominant-baseline="central" text-anchor="middle" font-size="88">${text}</text></svg>\n`;
}
