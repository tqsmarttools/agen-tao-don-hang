import { readJsonOrDefault, storePaths } from "./lib/phone-order-store.mjs";

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

  return args;
}

function formatDetail(detail) {
  if (!detail || typeof detail !== "object") {
    return "";
  }

  return JSON.stringify(detail, null, 2);
}

function latestLiveResult(steps) {
  const completedWithEvidence = [...steps]
    .reverse()
    .find((step) => step.completed && step.live_result);

  return completedWithEvidence || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = await readJsonOrDefault(storePaths.workerOutputPath, null);

  if (!payload) {
    throw new Error("No browser executor payload found.");
  }

  if (args.requestId && payload.request_id !== args.requestId) {
    throw new Error(
      `Browser executor payload request mismatch. Expected ${args.requestId}, got ${payload.request_id}.`,
    );
  }

  const steps = Array.isArray(payload.step_checklist) ? payload.step_checklist : [];
  const nextPending = steps.find((step) => !step.completed && !step.failed) || null;
  const lastEvidenceStep = latestLiveResult(steps);

  console.log(`Request: ${payload.request_id}`);
  console.log(`Mode: ${payload.execution_mode}`);
  console.log(`Dry run: ${payload.dry_run}`);
  console.log(
    `Progress: ${payload.progress?.completed_steps || 0}/${payload.progress?.total_steps || steps.length} completed`,
  );
  if (payload.progress?.next_actionable_step) {
    console.log(`Next actionable step: ${payload.progress.next_actionable_step}`);
  }

  if (nextPending) {
    console.log(`Next step: ${nextPending.order} - ${nextPending.action}`);
    console.log(`Guidance: ${nextPending.guidance}`);
    if (nextPending.operator_note) {
      console.log(`Operator note: ${nextPending.operator_note}`);
    }

    const detailText = formatDetail(nextPending.detail);
    if (detailText) {
      console.log("Step detail:");
      console.log(detailText);
    }

    console.log(
      `Retry command: node scripts/prepare-phone-order-step-retry.mjs --request-id ${payload.request_id} --step ${nextPending.order}`,
    );
  } else {
    console.log("Next step: none");
  }

  const failedSteps = steps.filter((step) => step.failed);
  if (failedSteps.length > 0) {
    console.log(`Failed steps: ${failedSteps.map((step) => step.order).join(", ")}`);
  }

  if (lastEvidenceStep) {
    console.log(`Last live result: step ${lastEvidenceStep.order} - ${lastEvidenceStep.action}`);
    console.log(formatDetail(lastEvidenceStep.live_result));
  }

  if (payload.record_commands?.created_template) {
    console.log(`Created command: ${payload.record_commands.created_template}`);
  }

  if (payload.record_commands?.failed_template) {
    console.log(`Failed command: ${payload.record_commands.failed_template}`);
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
