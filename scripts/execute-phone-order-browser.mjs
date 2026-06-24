import {
  appendWorkerLog,
  readJsonOrDefault,
  storePaths,
  writeJson,
  writeText,
} from "./lib/phone-order-store.mjs";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = {
    requestId: "",
    dryRun: false,
    live: false,
    completeStep: 0,
    failStep: 0,
    clearStep: 0,
    maxSteps: 0,
    note: "",
    reset: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--request-id") {
      args.requestId = argv[++index] || "";
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--live") {
      args.live = true;
    } else if (arg === "--complete-step") {
      args.completeStep = Math.max(0, Number(argv[++index] || 0));
    } else if (arg === "--fail-step") {
      args.failStep = Math.max(0, Number(argv[++index] || 0));
    } else if (arg === "--clear-step") {
      args.clearStep = Math.max(0, Number(argv[++index] || 0));
    } else if (arg === "--max-steps") {
      args.maxSteps = Math.max(0, Number(argv[++index] || 0));
    } else if (arg === "--note") {
      args.note = argv[++index] || "";
    } else if (arg === "--reset") {
      args.reset = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const activeMutations = [args.completeStep, args.failStep, args.clearStep].filter(Boolean).length;
  if (activeMutations > 1) {
    throw new Error("Use only one of --complete-step, --fail-step, or --clear-step at a time.");
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

    if (args.clearStep === order) {
      nextStep.completed = false;
      nextStep.failed = false;
      nextStep.operator_note = args.note || "";
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
  const nextActionableStep = stepChecklist.find((step) => !step.completed) || null;

  return {
    schema: "tq-sapo-phone-order-browser-executor/v1",
    exported_at: new Date().toISOString(),
    request_id: executionPlan.request_id,
    execution_mode: "chrome-sapo-browser-executor",
    dry_run: args.dryRun,
    live_mode_requested: args.live,
    ready_for_live_execution: executionPlan.ready_for_browser_automation === true,
    progress: {
      total_steps: stepChecklist.length,
      completed_steps: completedSteps,
      failed_steps: failedSteps,
      next_pending_step: nextPendingStep?.order || null,
      next_actionable_step: nextActionableStep?.order || null,
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
    `- Live mode requested: \`${payload.live_mode_requested}\``,
    `- Total steps: \`${payload.progress.total_steps}\``,
    `- Completed steps: \`${payload.progress.completed_steps}\``,
    `- Failed steps: \`${payload.progress.failed_steps}\``,
    `- Next pending step: \`${payload.progress.next_pending_step ?? "none"}\``,
    `- Next actionable step: \`${payload.progress.next_actionable_step ?? "none"}\``,
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

function resolveAdapter() {
  if (globalThis.phoneOrderBrowserAdapter) {
    return globalThis.phoneOrderBrowserAdapter;
  }

  return null;
}

function nextPendingSteps(payload, maxSteps) {
  const pending = (payload.step_checklist || []).filter((step) => !step.completed && !step.failed);
  if (!maxSteps || maxSteps >= pending.length) {
    return pending;
  }
  return pending.slice(0, maxSteps);
}

function handlerMethodName(action) {
  switch (action) {
    case "open_create_order_page":
      return "openCreateOrderPage";
    case "search_customer_by_phone":
      return "searchCustomerByPhone";
    case "select_existing_customer_if_shown":
      return "selectExistingCustomerIfShown";
    case "create_customer_if_missing":
      return "createCustomerIfMissing";
    case "ensure_shipping_address":
      return "ensureShippingAddress";
    case "add_product_by_sku":
      return "addProductBySku";
    case "switch_shipping_mode":
      return "switchShippingMode";
    case "set_customer_total":
      return "setCustomerTotal";
    case "set_cod_amount":
      return "setCodAmount";
    case "set_declared_package_value":
      return "setDeclaredPackageValue";
    case "leave_pickup_shift_blank_unless_requested":
      return "leavePickupShiftBlankUnlessRequested";
    case "submit_order":
      return "submitOrder";
    default:
      return "";
  }
}

function withStepMutation(payload, order, patch) {
  const nextPayload = structuredClone(payload);
  const step = nextPayload.step_checklist.find((item) => item.order === order);
  if (!step) {
    throw new Error(`Step ${order} was not found in the executor payload.`);
  }

  Object.assign(step, patch, { updated_at: new Date().toISOString() });
  nextPayload.exported_at = new Date().toISOString();
  nextPayload.progress.total_steps = nextPayload.step_checklist.length;
  nextPayload.progress.completed_steps = nextPayload.step_checklist.filter((item) => item.completed).length;
  nextPayload.progress.failed_steps = nextPayload.step_checklist.filter((item) => item.failed).length;
  nextPayload.progress.next_pending_step =
    nextPayload.step_checklist.find((item) => !item.completed && !item.failed)?.order || null;
  nextPayload.progress.next_actionable_step =
    nextPayload.step_checklist.find((item) => !item.completed)?.order || null;
  return nextPayload;
}

async function persistExecutorState(executionPlan, payload) {
  const notes = buildExecutionNotes(executionPlan, payload);
  await writeJson(storePaths.workerOutputPath, payload);
  await writeText(storePaths.executionNotesPath, notes);
}

async function runLiveExecution(executionPlan, payload, args, adapter) {
  if (!payload.ready_for_live_execution) {
    throw new Error("Execution plan is not marked ready for live browser execution.");
  }

  if (!adapter) {
    throw new Error(
      "Live browser mode requires a phoneOrderBrowserAdapter on globalThis. Inject an adapter before calling execute-phone-order-browser.mjs with --live.",
    );
  }

  let nextPayload = payload;
  const steps = nextPendingSteps(payload, args.maxSteps);
  for (const step of steps) {
    const methodName = handlerMethodName(step.action);
    if (!methodName || typeof adapter[methodName] !== "function") {
      throw new Error(`No live handler is available for action: ${step.action}`);
    }

    try {
      await adapter[methodName](step.detail, {
        executionPlan,
        payload: nextPayload,
        items: executionPlan.items || [],
      });

      nextPayload = withStepMutation(nextPayload, step.order, {
        completed: true,
        failed: false,
        operator_note: `Completed by live adapter via ${methodName}.`,
      });
      await persistExecutorState(executionPlan, nextPayload);

      await appendWorkerLog({
        request_id: executionPlan.request_id,
        event_type: "browser_executor_live_step_completed",
        execution_mode: nextPayload.execution_mode,
        step: step.order,
        action: step.action,
      });
    } catch (error) {
      nextPayload = withStepMutation(nextPayload, step.order, {
        completed: false,
        failed: true,
        operator_note: error instanceof Error ? error.message : String(error),
      });
      await persistExecutorState(executionPlan, nextPayload);

      await appendWorkerLog({
        request_id: executionPlan.request_id,
        event_type: "browser_executor_live_step_failed",
        execution_mode: nextPayload.execution_mode,
        step: step.order,
        action: step.action,
        note: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  return nextPayload;
}

export async function runBrowserExecutor(rawArgs) {
  const args = Array.isArray(rawArgs) ? parseArgs(rawArgs) : rawArgs;
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
  let payload = buildExecutorPayload(executionPlan, previousPayload, args);
  await persistExecutorState(executionPlan, payload);

  if (args.live) {
    payload = await runLiveExecution(executionPlan, payload, args, resolveAdapter());
  }

  await appendWorkerLog({
    request_id: executionPlan.request_id,
    event_type: args.live
      ? "browser_executor_live_run_finished"
      : args.completeStep
      ? "browser_executor_step_completed"
      : args.failStep
        ? "browser_executor_step_failed"
        : args.clearStep
          ? "browser_executor_step_cleared"
        : args.reset
          ? "browser_executor_reset"
          : "browser_executor_prepared",
    execution_mode: payload.execution_mode,
    dry_run: args.dryRun,
    step: args.completeStep || args.failStep || args.clearStep || 0,
    note: args.note || "",
  });

  return {
    args,
    executionPlan,
    payload,
  };
}

async function main() {
  const { args, executionPlan } = await runBrowserExecutor(process.argv.slice(2));
  console.log(
    `${args.dryRun ? "Prepared" : "Updated"} browser executor payload for ${executionPlan.request_id} at ${storePaths.workerOutputPath}`,
  );
}

const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.stack || String(error));
    process.exit(1);
  });
}
