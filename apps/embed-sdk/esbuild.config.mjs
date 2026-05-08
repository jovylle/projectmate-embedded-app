import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/embed.js",
  bundle: true,
  format: "iife",
  globalName: "ProjectMate",
  platform: "browser",
  target: "es2020",
  minify: true,
  sourcemap: true,
});
