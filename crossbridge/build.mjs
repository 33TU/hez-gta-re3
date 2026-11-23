import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import crossbridge from "../tools/crossbridge.js";

const port = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(port, "..");
const out = join(port, "out");
const submodule = join(root, "vendor", "librw");

function git(args, options) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  }).trim();
}

async function build(work) {
  if (!existsSync(join(submodule, "src", "rwbase.h"))) {
    throw new Error("Initialize librw first: git submodule update --init vendor/librw");
  }
  const revision = git(["rev-parse", "HEAD"]);
  const source = join(work, "re3", "src");
  mkdirSync(join(work, "re3"));
  cpSync(join(root, "src"), source, { recursive: true });
  rmSync(join(source, "extras", "GitSHA1.cpp"), { force: true });
  const template = readFileSync(join(source, "extras", "GitSHA1.cpp.in"), "utf8");
  mkdirSync(join(work, "generated"));
  writeFileSync(
    join(work, "generated", "GitSHA1.cpp"),
    template.replaceAll("@GIT_SHA1@", revision),
  );

  // Materialize the recorded submodule commit using a disposable index and
  // work tree, so local changes and the developer's Git index stay intact.
  const librw = join(work, "librw");
  mkdirSync(librw);
  const gitDir = git(["-C", submodule, "rev-parse", "--absolute-git-dir"]);
  const pinned = git(["rev-parse", revision + ":vendor/librw"]);
  const gitArgs = ["--git-dir", gitDir, "--work-tree", librw, "-c", "core.autocrlf=false"];
  const options = {
    cwd: librw,
    env: { ...process.env, GIT_INDEX_FILE: join(work, "librw.index") },
  };
  git([...gitArgs, "read-tree", "--reset", "-u", pinned], options);
  git([...gitArgs, "apply", join(port, "librw.patch")], options);

  cpSync(join(port, "host"), join(work, "host"), { recursive: true });
  for (const file of ["game.mk", "librw.mk", "sdk-game.sh"]) {
    copyFileSync(join(port, file), join(work, file));
  }
  const status = await crossbridge(["bash", "sdk-game.sh"], work);
  if (status !== 0) return status;

  mkdirSync(out, { recursive: true });
  copyFileSync(join(work, "revc-game.swf"), join(out, "revc-game.swf"));
  copyFileSync(join(port, "app.xml"), join(out, "app.xml"));
  copyFileSync(join(librw, "LICENSE"), join(out, "librw-LICENSE"));
  return 0;
}

const work = mkdtempSync(join(tmpdir(), "revc-crossbridge-"));
try {
  process.exitCode = await build(work);
} catch (error) {
  console.error(error.message);
  process.exitCode = error.status || 1;
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
