const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { constants } = require("node:os");
const path = require("node:path");

// Windows PowerShell passes a single command line to docker.exe. Quote each
// argument and double backslashes before embedded quotes or the closing quote.
function windowsArgument(arg) {
  const escaped = arg.replace(/(\\*)"/g, '$1$1\\"');
  return '"' + escaped.replace(/\\+$/, "$&$&") + '"';
}

async function crossbridge(args, cwd = process.cwd()) {
  const env = { ...process.env };
  env.CROSSBRIDGE_IMAGE ||=
    "ghcr.io/33tu/crossbridge@sha256:486ae832869e84cc25be62d3332ffffde64a8d42cd415f0a3346dddc5c98d84c";

  let shell = "bash";
  let command = [path.join(__dirname, "crossbridge"), ...args];
  if (process.platform === "win32") {
    shell = "powershell.exe";
    // Bind the array directly so -v, -Command, etc. are SDK arguments.
    env.RE3_CROSSBRIDGE_LAUNCHER = path.join(__dirname, "crossbridge.ps1");
    env.RE3_CROSSBRIDGE_ARGS = JSON.stringify({ args: args.map(windowsArgument) });
    command = [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ErrorActionPreference = 'Stop'; $PSNativeCommandArgumentPassing = 'Legacy'; " +
        "$commandArgs = (ConvertFrom-Json -InputObject $env:RE3_CROSSBRIDGE_ARGS).args; " +
        "& $env:RE3_CROSSBRIDGE_LAUNCHER -Command $commandArgs; exit $LASTEXITCODE",
    ];
  }

  const child = spawn(shell, command, { cwd, env, stdio: "inherit" });
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    const [status, signal] = await once(child, "close");
    return status ?? 128 + constants.signals[signal];
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

module.exports = crossbridge;
if (require.main === module) {
  crossbridge(process.argv.slice(2)).then(
    (status) => {
      process.exitCode = status;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
