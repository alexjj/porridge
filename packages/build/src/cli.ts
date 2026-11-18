import { posix } from "node:path";
import { PorridgeError } from "@porridge/core";
import { buildToDirectory } from "./index.js";

const USAGE = `Usage: porridge build [content-dir] [output-dir] [--base-url URL]

Builds a porridge blog into a static site.

  content-dir      folder containing blog.opml (default: .)
  output-dir       where to write the site; replaced on each build (default: _site)
  --base-url URL   use this instead of porridge:baseUrl, e.g. for a local preview
`;

const inActions = process.env.GITHUB_ACTIONS === "true";

/** Escape a value for a GitHub Actions workflow command. */
const ghEscape = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const ghProp = (s: string) => ghEscape(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

function report(level: "warning" | "error", message: string, file?: string) {
  if (inActions) {
    const props = file ? ` file=${ghProp(file)}` : "";
    console.log(`::${level}${props}::${ghEscape(message)}`);
  } else {
    console.error(`${level}: ${file ? `${file}: ` : ""}${message}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const positional: string[] = [];
  let baseUrl: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      return 0;
    } else if (arg === "--base-url") {
      baseUrl = argv[++i];
      if (!baseUrl) {
        console.error("--base-url needs a value.\n\n" + USAGE);
        return 2;
      }
    } else if (arg.startsWith("--base-url=")) {
      baseUrl = arg.slice("--base-url=".length);
    } else if (arg.startsWith("-")) {
      console.error(`Unknown option ${arg}.\n\n${USAGE}`);
      return 2;
    } else {
      positional.push(arg);
    }
  }

  const [command, contentDir = ".", outDir = "_site", ...extra] = positional;
  if (command !== "build" || extra.length) {
    console.error(USAGE);
    return 2;
  }

  // Report files relative to where the build ran, so annotations point at them.
  const repoPath = (file: string) => posix.normalize(posix.join(contentDir.replace(/\\/g, "/"), file));

  try {
    const { site, warnings } = await buildToDirectory(contentDir, outDir, { baseUrl });
    for (const w of warnings) report("warning", w.message, repoPath(w.file));
    const entries = site.days.reduce((n, d) => n + d.entries.length, 0);
    console.log(
      `Built ${plural(entries, "entry", "entries")} on ${plural(site.days.length, "day")} and ` +
        `${plural(site.pages.length, "page")} into ${outDir}` +
        (warnings.length ? ` with ${plural(warnings.length, "warning")}.` : "."),
    );
    return 0;
  } catch (err) {
    if (err instanceof PorridgeError) {
      report("error", err.message, err.file && repoPath(err.file));
    } else {
      report("error", err instanceof Error ? err.message : String(err));
    }
    return 1;
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

process.exitCode = await main(process.argv.slice(2));
