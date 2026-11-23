export * from "./opml.js";
export * from "./dates.js";
export * from "./markdown.js";
export * from "./video.js";
export * from "./site.js";
export * from "./render.js";
export { SCRIPT, STYLESHEET } from "./theme.js";

import { loadSite, type ContentSource, type LoadOptions, type Site, type Warning } from "./site.js";
import { renderSite, type OutputFile } from "./render.js";

export interface BuildResult {
  site: Site;
  files: OutputFile[];
  warnings: Warning[];
}

/** Load and render a whole site. Images are copied by the caller. */
export async function buildSite(source: ContentSource, options: LoadOptions = {}): Promise<BuildResult> {
  const site = await loadSite(source, options);
  return { site, files: renderSite(site), warnings: site.warnings };
}
