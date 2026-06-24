import {
  appendWorkerLog,
  readJsonOrDefault,
  storePaths,
  writeJson,
  writeText,
} from "./lib/phone-order-store.mjs";

function parseArgs(argv) {
  const args = {
    requestId: "",
    dryRun: false,
    completeStep: 0,
    failStep: 0,
    note: "",
    reset: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--request-id") {
      args.requestId = argv[++index] || "";
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--complete-step") {
      args.completeStep = Math.max(0, Number(argv[++index] || 0));
    } else if (arg === "--fail-step") {
      args.failStep = Math.max(0, Number(argv[++index] || 0));
    } else if (arg === "--note") {
      args.note = argv[++index] || "";
    } else if (arg === "--reset") {
      args.reset = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.completeStep && args.failStep) {
    throw new Error("Use either --complete-step or --fail-step, not both.");
  }

  return args;
}

function stepGuidance(detail) {
  switch (detail.action) {
    case "open_create_order_page":
      return "Open the Sapo create-order page in the already-authenticated Chrome profile.";
    case "search_customer_by_phone":
      return `Search customer by phone: ${detail.phone}.`;
    case "select_existing_customer_if_shown":
      return `Select the existing customer if the phone lookup shows the expected match: ${detail.customer_name}.`;
    case "create_customer_if_missing":
      return `Create a new customer if phone lookup does not return a usable match: ${detail.customer_name}.`;
    case "ensure_shipping_address":
      return "Verify province, district, ward, and address detail match the normalized address.";
    case "add_product_by_sku":
      return `Add product by SKU ${detail.sku} with quantity ${detail.quantity}.`;
    case "switch_shipping_mode":
      return `Switch shipping mode to carrier flow and prefer ${detail.preferred_carrier}.`;
    case "set_customer_total":
      return `Adjust line pricing so the customer-facing total equals ${detail.amount}.`;
    case "set_cod_amount":
      return `Set COD amount to ${detail.amount}.`;
    case "set_declared_package_value":
      return `Set declared package value to ${detail.amount}.`;
    case "leave_pickup_shift_blank_unless_requested":
      return detail.requested_pickup_shift_note
        ? `A pickup-shift instruction exists in the note: ${detail.requested_pickup_shift_note}`
        : "Leave pickup shift blank.";
    case "submit_order":
      return `Submit the order and confirm with button: ${detail.confirmation_button}.`;
    default:
      return "Follow the step detail exactly as recorded in the execution plan.";
  }
}

function buildStepChecklist(executionPlan, previousPayload, args) {
  const previousSteps = Array.isArray(previousPayload?.step_checklist)
    ? previousPayload.step_checklist
    : [];
  const previousByOrder = new Map(previousSteps.map((step) => [step.order, step]));

  return (executionPlan.browser_steps || []).map((step, index) => {
    const order = index + 1;
    const previous = previousByOrder.get(order);
    const completed = args.reset ? false : previous?.completed || false;
    const failed = args.reset ? false : previous?.failed || false;
    const operatorNote =
      !args.reset && previous?.operator_note ? String(previous.operator_note) : "";

    const nextStep = {
      order,
      action: step.action,
      completed,
      failed,
      detail: step,
      guidance: stepGuidance(step),
      operator_note: operatorNote,
      updated_at: previous?.updated_at || "",
    };

    if (args.completeStep === order) {
      nextStep.completed = true;
      nextStep.failed = false;
      nextStep.operator_note = args.note || "Marked completed by operator.";
      nextStep.updated_at = new Date().toISOString();
    }

    if (args.failStep === order) {
      nextStep.completed = false;
      nextStep.failed = true;
      nextStep.operator_note = args.note || "Marked failed by operator.";
      nextStep.updated_at = new Date().toISOString();
    }

    if (args.reset) {
      nextStep.operator_note = "";
      nextStep.updated_at = "";
    }

    return nextStep;
  });
}

function buildExecutorPayload(executionPlan, previousPayload, args) {
  const stepChecklist = buildStepChecklist(executionPlan, previousPayload, args);
  const completedSteps = stepChecklist.filter((step) => step.completed).length;
  const failedSteps = stepChecklist.filter((step) => step.failed).length;
  const nextPendingStep = stepChecklist.find((step) => !step.completed && !step.failed) || null;

  return {
    schema: "tq-sapo-phone-order-browser-executor/v1",
    exported_at: new Date().toISOString(),
    request_id: executionPlan.request_id,
    execution_mode: "chrome-sapo-browser-executor",
    dry_run: args.dryRun,
    ready_for_live_execution: executionPlan.ready_for_browser_automation === true,
    progress: {
      total_steps: stepChecklist.length,
      completed_steps: completedSteps,
      failed_steps: failedSteps,
      next_pending_step: nextPendingStep?.order || null,
    },
    preflight: executionPlan.preflight || [],
    manual_checkpoints: executionPlan.manual_checkpoints || [],
    step_checklist: stepChecklist,
    record_commands: executionPlan.record_commands || {},
    warnings: [
      "This executor still stops short of real Chrome automation. It prepares and tracks the browser run state only.",
      ...(executionPlan.warnings || []),
    ],
  };
}

function buildExecutionNotes(executionPlan, payload) {
  const lines = [
    "# Phone Order Browser Execution",
    "",
    `- Request ID: \`${executionPlan.request_id}\``,
    `- Ready for live execution: \`${payload.ready_for_live_execution}\``,
    `- Total steps: \`${payload.progress.total_steps}\``,
    `- Completed steps: \`${payload.progress.completed_steps}\``,
    `- Failed steps: \`${payload.progress.failed_steps}\``,
    `- Next pending step: \`${payload.progress.next_pending_step ?? "none"}\``,
    "",
    "## Preflight",
    "",
    ...payload.preflight.map((item) => `- [ ] ${item.label} Expected: ${item.expected}`),
    "",
    "## Browser Steps",
    "",
    ...payload.step_checklist.flatMap((step) => {
      const mark = step.completed ? "x" : step.failed ? "!" : " ";
      const note = step.operator_note ? ` Note: ${step.operator_note}` : "";
      return [`- [${mark}] Step ${step.order}: ${step.guidance}${note}`];
    }),
    "",
    "## Manual Checkpoints",
    "",
    ...payload.manual_checkpoints.map((item) => `- [ ] ${item}`),
    "",
    "## Record Result Commands",
    "",
    `- Created: \`${payload.record_commands.created_template || ""}\``,
    `- Failed: \`${payload.record_commands.failed_template || ""}\``,
    "",
  ];

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const executionPlan = await readJsonOrDefault(storePaths.executionPlanPath, null);

  if (!executionPlan) {
    throw new Error(
      "Missing execution plan. Run scripts/prepare-phone-order-execution.mjs before execute-phone-order-browser.mjs.",
    );
  }

  if (args.requestId && executionPlan.request_id !== args.requestId) {
    throw new Error(
      `Execution plan request mismatch. Expected ${args.requestId}, got ${executionPlan.request_id}.`,
    );
  }

  const previousPayload = await readJsonOrDefault(storePaths.workerOutputPath, null);
  const payload = buildExecutorPayload(executionPlan, previousPayload, args);
  const notes = buildExecutionNotes(executionPlan, payload);

  await writeJson(storePaths.workerOutputPath, payload);
  await writeText(storePaths.executionNotesPath, notes);

  await appendWorkerLog({
    request_id: executionPlan.request_id,
    event_type: args.completeStep
      ? "browser_executor_step_completed"
      : args.failStep
        ? "browser_executor_step_failed"
        : args.reset
          ? "browser_executor_reset"
          : "browser_executor_prepared",
    execution_mode: payload.execution_mode,
    dry_run: args.dryRun,
    step: args.completeStep || args.failStep || 0,
    note: args.note || "",
  });

  console.log(
    `${args.dryRun ? "Prepared" : "Updated"} browser executor payload for ${executionPlan.request_id} at ${storePaths.workerOutputPath}`,
  );
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
