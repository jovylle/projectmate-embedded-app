import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site/out");

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "overlay"), { recursive: true });

await cp(join(root, "apps/overlay-app/dist"), join(out, "overlay"), { recursive: true });
await cp(join(root, "apps/embed-sdk/dist/embed.js"), join(out, "embed.js"));

const indexHtml = await readFile(join(root, "index.html"), "utf8");
await writeFile(join(out, "index.html"), indexHtml);

let demo = await readFile(join(root, "demo.html"), "utf8");
demo = demo
  .replaceAll("./apps/embed-sdk/dist/embed.js", "./embed.js")
  .replaceAll("./apps/overlay-app/dist/index.html", "./overlay/index.html");
await writeFile(join(out, "demo.html"), demo);

console.log("site/out ready:", out);
