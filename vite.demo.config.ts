import { defineConfig } from "vite";
import { resolve } from "node:path";

/** Serves repo root so `test.html` can load built embed + overlay from disk paths. */
export default defineConfig({
  root: resolve(__dirname),
  server: {
    port: 8787,
    strictPort: true,
    open: "/test.html",
  },
  publicDir: false,
});
