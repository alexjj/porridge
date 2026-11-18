import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { buildSite, type BuildResult, type ContentSource, type LoadOptions } from "@porridge/core";

/** Reads content from a directory on disk. */
export function nodeSource(root: string): ContentSource {
  return {
    async read(path) {
      try {
        return await readFile(join(root, path), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
    },
    async list(dir) {
      try {
        const entries = await readdir(join(root, dir), { withFileTypes: true });
        return entries.filter((e) => e.isFile()).map((e) => e.name);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
    },
  };
}

/**
 * Build the content in `contentDir` into `outDir`. The output directory is
 * replaced, so it must not contain the content.
 */
export async function buildToDirectory(contentDir: string, outDir: string, options: LoadOptions = {}): Promise<BuildResult> {
  const content = resolve(contentDir);
  const out = resolve(outDir);
  const rel = relative(out, content);
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep))) {
    throw new Error(`The output directory ${outDir} can't contain the content directory.`);
  }

  const result = await buildSite(nodeSource(content), options);

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const file of result.files) {
    const target = join(out, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  const images = join(content, "images");
  if (await exists(images)) await cp(images, join(out, "images"), { recursive: true });
  // Tell GitHub Pages not to run Jekyll over the output.
  await writeFile(join(out, ".nojekyll"), "");
  return result;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
