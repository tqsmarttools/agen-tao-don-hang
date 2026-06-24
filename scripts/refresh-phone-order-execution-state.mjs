import { runBrowserExecutor } from "./execute-phone-order-browser.mjs";
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const args = {
    requestId: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--request-id") {
      args.requestId = argv[++index] || "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.requestId) {
    throw new Error(
      "Usage: node scripts/refresh-phone-order-execution-state.mjs --request-id <id>",
    );
  }

  return args;
}

async function runNodeScript(scriptPath, scriptArgs) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${scriptPath} exited with code ${code}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  await runNodeScript("scripts/prepare-phone-order-execution.mjs", [
    "--request-id",
    args.requestId,
    "--from-state",
  ]);

  const result = await runBrowserExecutor({
    requestId: args.requestId,
    dryRun: false,
    live: false,
    completeStep: 0,
    failStep: 0,
    clearStep: 0,
    maxSteps: 0,
    note: "",
    reset: false,
  });

  console.log(
    `Refreshed execution state for ${args.requestId}. Next actionable step: ${result.payload.progress.next_actionable_step}`,
  );
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
