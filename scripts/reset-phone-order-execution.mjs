import { storePaths, writeJson, writeText } from "./lib/phone-order-store.mjs";

async function main() {
  await writeJson(storePaths.workerOutputPath, {
    schema: "tq-sapo-phone-order-browser-executor/v1",
    exported_at: new Date().toISOString(),
    request_id: "",
    execution_mode: "chrome-sapo-browser-executor",
    dry_run: true,
    ready_for_live_execution: false,
    progress: {
      total_steps: 0,
      completed_steps: 0,
      failed_steps: 0,
      next_pending_step: null,
    },
    preflight: [],
    manual_checkpoints: [],
    step_checklist: [],
    record_commands: {},
    warnings: ["Execution state was reset."],
  });

  await writeText(
    storePaths.executionNotesPath,
    "# Phone Order Browser Execution\n\nExecution state was reset.\n",
  );

  console.log("Reset phone-order browser execution state.");
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
