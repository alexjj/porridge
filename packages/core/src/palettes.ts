// Colour themes for the site: the default plus five presets from well-known
// open colour schemes, each with a light and a dark version. Values come from
// each scheme's published palette; text, muted text and links are chosen from
// it (or, for a few light-mode links, darkened) so that text, links and muted
// text keep at least 4.5:1 contrast against the background.

export const COLOR_TOKENS = ["bg", "text", "muted", "rule", "link", "link-hover"] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
export type Palette = Record<ColorToken, string>;

export interface Theme {
  name: string;
  label: string;
  description: string;
  light: Palette;
  dark: Palette;
}

export const DEFAULT_THEME = "porridge";

export const THEMES: Theme[] = [
  {
    name: "porridge",
    label: "Porridge",
    description: "Warm paper and cinnamon (the default)",
    light: { bg: "#fbfaf6", text: "#24221e", muted: "#7a756c", rule: "#e6e1d6", link: "#8a4b1f", "link-hover": "#5e3110" },
    dark: { bg: "#1c1b18", text: "#e9e5dc", muted: "#9b958a", rule: "#34322d", link: "#e0a46e", "link-hover": "#f3c79c" },
  },
  {
    // https://ethanschoonover.com/solarized/
    name: "solarized",
    label: "Solarized",
    description: "Classic cream and teal",
    light: { bg: "#fdf6e3", text: "#073642", muted: "#586e75", rule: "#eee8d5", link: "#b05000", "link-hover": "#073642" },
    dark: { bg: "#002b36", text: "#eee8d5", muted: "#93a1a1", rule: "#073642", link: "#2aa198", "link-hover": "#b58900" },
  },
  {
    // https://www.nordtheme.com/docs/colors-and-palettes
    name: "nord",
    label: "Nord",
    description: "Cool Arctic blues",
    light: { bg: "#eceff4", text: "#2e3440", muted: "#4c566a", rule: "#d8dee9", link: "#4c6a91", "link-hover": "#2e3440" },
    dark: { bg: "#2e3440", text: "#eceff4", muted: "#a7b1c2", rule: "#434c5e", link: "#88c0d0", "link-hover": "#8fbcbb" },
  },
  {
    // https://github.com/morhetz/gruvbox
    name: "gruvbox",
    label: "Gruvbox",
    description: "Warm and retro",
    light: { bg: "#fbf1c7", text: "#3c3836", muted: "#665c54", rule: "#ebdbb2", link: "#af3a03", "link-hover": "#9d0006" },
    dark: { bg: "#282828", text: "#ebdbb2", muted: "#a89984", rule: "#3c3836", link: "#fe8019", "link-hover": "#fabd2f" },
  },
  {
    // https://catppuccin.com/palette (Latte and Mocha)
    name: "catppuccin",
    label: "Catppuccin",
    description: "Soft pastels",
    light: { bg: "#eff1f5", text: "#4c4f69", muted: "#5c5f77", rule: "#ccd0da", link: "#8839ef", "link-hover": "#4c4f69" },
    dark: { bg: "#1e1e2e", text: "#cdd6f4", muted: "#a6adc8", rule: "#313244", link: "#cba6f7", "link-hover": "#f5c2e7" },
  },
  {
    // https://rosepinetheme.com/palette (Dawn and Main)
    name: "rose-pine",
    label: "Rosé Pine",
    description: "Muted rose and pine",
    light: { bg: "#faf4ed", text: "#575279", muted: "#6e6a86", rule: "#dfdad9", link: "#286983", "link-hover": "#575279" },
    dark: { bg: "#191724", text: "#e0def4", muted: "#908caa", rule: "#403d52", link: "#ebbcba", "link-hover": "#f6c177" },
  },
];

export const themeByName = (name: string): Theme | undefined => THEMES.find((t) => t.name === name);

/** A colour value that's safe to put in a stylesheet (no ; { } or quotes). */
export function isSafeColor(value: string): boolean {
  return /^(#[0-9a-f]{3,8}|[a-z]+|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([0-9a-z.,%\s/+-]*\))$/i.test(value.trim());
}

/** "bg: #fff; text: #000" → { bg: "#fff", text: "#000" } (unknown or unsafe entries are reported). */
export function parsePalette(value: string): { palette: Partial<Palette>; problems: string[] } {
  const palette: Partial<Palette> = {};
  const problems: string[] = [];
  for (const part of value.split(";")) {
    if (!part.trim()) continue;
    const [rawKey, ...rest] = part.split(":");
    const key = rawKey!.trim() as ColorToken;
    const color = rest.join(":").trim();
    if (!COLOR_TOKENS.includes(key)) problems.push(`unknown colour "${rawKey!.trim()}"`);
    else if (!isSafeColor(color)) problems.push(`"${color}" isn't a colour`);
    else palette[key] = color;
  }
  return { palette, problems };
}

export const formatPalette = (p: Palette): string => COLOR_TOKENS.map((k) => `${k}: ${p[k]}`).join("; ");

/** CSS that sets the site's colours, light and dark. */
export function paletteCss(light: Palette, dark: Palette): string {
  const vars = (p: Palette) => COLOR_TOKENS.map((k) => `--${k}: ${p[k]};`).join(" ");
  return `
/* Colours chosen in Blog settings */
:root { ${vars(light)} }
@media (prefers-color-scheme: dark) {
  :root { ${vars(dark)} }
}
`;
}
