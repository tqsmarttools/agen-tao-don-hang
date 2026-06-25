import { spawn } from "node:child_process";

const steps = [
  ["scripts/fetch-phone-order-inbox.mjs", []],
  ["scripts/import-phone-order-requests.mjs", []],
  ["scripts/process-phone-order-requests.mjs", []],
  ["scripts/inspect-phone-order-pipeline.mjs", ["--latest"]],
];

async function runNodeScript(scriptPath, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
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
  for (const [scriptPath, args] of steps) {
    await runNodeScript(scriptPath, args);
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
