import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  // Relative asset paths, so the editor works from any URL path.
  base: "./",
  plugins: [svelte()],
  build: { outDir: "dist", emptyOutDir: true },
});
