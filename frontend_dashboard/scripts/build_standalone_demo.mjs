// Bundles src/standalone/demo.ts and inlines it into ../traffic_demo.html (between the marker
// comments) so the standalone simulator stays a single, zero-install, file:// friendly page.
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = resolve(root, "..", "traffic_demo.html");
const START = "<!-- @twin-bundle:start -->";
const END = "<!-- @twin-bundle:end -->";

const result = await build({
  entryPoints: [resolve(root, "src/standalone/demo.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  write: false,
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

const html = readFileSync(htmlPath, "utf8");
const a = html.indexOf(START);
const b = html.indexOf(END);
if (a < 0 || b < a) throw new Error(`Bundle markers not found in ${htmlPath}`);
const out = `${html.slice(0, a + START.length)}\n  <script>${js}</script>\n  ${html.slice(b)}`;
writeFileSync(htmlPath, out);
console.log(`Inlined ${(js.length / 1024).toFixed(1)} KB twin bundle into ${htmlPath}`);
