import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// GitHub Pages serves this project under /worstcase/; local dev stays at /.
const base = process.env.WORSTCASE_BASE ?? "/";

export default defineConfig({
  base,
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("../../dist/web", import.meta.url)),
    emptyOutDir: true,
  },
});
