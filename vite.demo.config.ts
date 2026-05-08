import { defineConfig } from "vite";
import { resolve } from "node:path";

/** Serves repo root: `index.html` (home), `demo.html` (widget), and built app paths. */
export default defineConfig({
  root: resolve(__dirname),
  server: {
    port: 8787,
    strictPort: true,
    open: "/index.html",
  },
  publicDir: false,
});
