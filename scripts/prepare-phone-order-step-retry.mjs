import { runBrowserExecutor } from "./execute-phone-order-browser.mjs";

function parseArgs(argv) {
  const args = {
    requestId: "",
    step: 0,
    note: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--request-id") {
      args.requestId = argv[++index] || "";
    } else if (arg === "--step") {
      args.step = Math.max(0, Number(argv[++index] || 0));
    } else if (arg === "--note") {
      args.note = argv[++index] || "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.requestId || !args.step) {
    throw new Error(
      "Usage: node scripts/prepare-phone-order-step-retry.mjs --request-id <id> --step <number> [--note <text>]",
    );
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runBrowserExecutor({
    requestId: args.requestId,
    dryRun: false,
    live: false,
    completeStep: 0,
    failStep: 0,
    clearStep: args.step,
    maxSteps: 0,
    note: args.note || `Retry step ${args.step}`,
    reset: false,
  });

  console.log(
    `Prepared retry for step ${args.step}. Next actionable step: ${result.payload.progress.next_actionable_step}`,
  );
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
