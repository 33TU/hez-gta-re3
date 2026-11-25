const { spawnSync } = require("node:child_process");

const formatter = process.platform === "win32" ? '"%ASFORMAT%"' : '"$ASFORMAT"';
const run = spawnSync(`${formatter} -write-files crossbridge/host/Console.as`, {
  shell: true,
  encoding: "utf8",
  env: { ...process.env, ASFORMAT: process.env.ASFORMAT || "asformat" },
});

const output = (run.stdout ?? "") + (run.stderr ?? "");
if (output) process.stderr.write(output);
if (run.error) console.error(run.error.message);
// Royale 0.9.12 can print a parse error and still return status zero.
if (run.error || run.status !== 0 || /\bError:/i.test(output)) process.exitCode = 1;
