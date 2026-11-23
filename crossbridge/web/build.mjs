// Bundle the npm player, then copy the compiler and the two browser entry points.
import { build } from "esbuild";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const out = new URL("../out/", import.meta.url);
await mkdir(out, { recursive: true });
await build({
  absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
  entryPoints: ["aot.js", "jit.js"],
  outdir: fileURLToPath(out),
  bundle: true,
  splitting: true,
  chunkNames: "modules/[name]-[hash]",
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "eof",
});
for (const file of ["index.html", "jit.html", "game.css"]) {
  await copyFile(new URL(file, import.meta.url), new URL(file, out));
}
await copyFile(
  new URL(import.meta.resolve("@swf2es/codegen/codegen.wasm")),
  new URL("codegen.wasm", out),
);

// Keep the npm packages' notices with the bundled code in the offline build.
const packages = new URL("../../node_modules/@swf2es/", import.meta.url);
for (const name of await readdir(packages)) {
  if (name === "cli") continue;
  const source = new URL(name + "/", packages);
  const dest = new URL("licenses/" + name + "/", out);
  await mkdir(dest, { recursive: true });
  for (const file of await readdir(source)) {
    if (file.startsWith("LICENSE")) await copyFile(new URL(file, source), new URL(file, dest));
  }
}
