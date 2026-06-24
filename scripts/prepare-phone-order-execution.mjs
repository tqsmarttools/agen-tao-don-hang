import {
  appendWorkerLog,
  findPlanItem,
  findQueueRequest,
  findStatusEntry,
  loadPhoneOrderState,
  readJsonOrDefault,
  storePaths,
  writeJson,
} from "./lib/phone-order-store.mjs";
import { buildBrowserStepsFromPlanLike } from "./lib/phone-order-browser-steps.mjs";

function parseArgs(argv) {
  const args = {
    requestId: "",
    fromState: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--request-id") {
      args.requestId = argv[++index] || "";
    } else if (arg === "--from-state") {
      args.fromState = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function buildPreflight(bundle) {
  const requestedPickupShiftNote = bundle.shipping_instructions?.requested_pickup_shift_note || "";

  return [
    {
      id: "chrome_profile",
      label: "Chrome must already be open in the working Sapo profile.",
      required: true,
      expected: "Profile with active Sapo session",
    },
    {
      id: "sapo_session",
      label: "Sapo admin session must already be signed in.",
      required: true,
      expected: "Create-order page is reachable without login",
    },
    {
      id: "carrier_rule",
      label: "Use GHN as the preferred carrier unless the bundle says otherwise.",
      required: true,
      expected: bundle.operational_defaults?.preferred_carrier || "GHN",
    },
    {
      id: "pickup_shift_rule",
      label: "Leave pickup shift blank unless the admin note explicitly requests it.",
      required: true,
      expected: requestedPickupShiftNote || "leave blank",
    },
  ];
}

function buildManualCheckpoints(bundle) {
  const checkpoints = [
    "Verify the correct customer is attached before adding products.",
    "Verify all SKU lines and quantities after product search completes.",
    "Verify COD equals the customer-facing total order value.",
    "Verify declared package value equals the customer-facing total order value.",
    "Verify GHN is selected before final submit.",
  ];

  if (bundle.shipping_instructions?.requires_manual_pickup_shift) {
    checkpoints.push(
      `Pickup shift was explicitly requested in note: ${bundle.shipping_instructions.requested_pickup_shift_note}`,
    );
  }

  return checkpoints;
}

function buildRecordCommands(bundle) {
  const createdBase = [
    "node",
    "scripts/record-phone-order-result.mjs",
    "--request-id",
    bundle.request_id,
    "--status",
    "created",
    "--carrier",
    bundle.operational_defaults?.preferred_carrier || "GHN",
  ];

  const failedBase = [
    "node",
    "scripts/record-phone-order-result.mjs",
    "--request-id",
    bundle.request_id,
    "--status",
    "failed",
    "--message",
    "Describe the blocking reason here",
  ];

  return {
    created_template: createdBase.join(" "),
    failed_template: failedBase.join(" "),
  };
}

function effectiveSourceStatus(planItem, statusEntry, queueRequest) {
  return statusEntry?.status || queueRequest?.status || planItem?.status || "";
}

function rebuildBundleFromState(args, queueRequest, planItem, statusEntry) {
  if (!queueRequest || !planItem) {
    return null;
  }

  return {
    request_id: planItem.request_id,
    claimed_at: new Date().toISOString(),
    source_status: effectiveSourceStatus(planItem, statusEntry, queueRequest),
    execution_mode: "chrome-sapo-script",
    operational_defaults: {
      preferred_carrier: "GHN",
      shipping_fee_payer: "shop",
      pickup_shift_behavior: "leave_blank_unless_requested",
      cod_amount: planItem.request_snapshot?.order_total_including_shipping || 0,
      declared_package_value: planItem.request_snapshot?.order_total_including_shipping || 0,
    },
    customer: {
      request_name: planItem.request_snapshot?.customer?.name || "",
      phone: planItem.request_snapshot?.customer?.phone || "",
      existing_customer_match: planItem.customer_match,
    },
    normalized_address: planItem.normalized_address,
    items: planItem.product_matches || [],
    note: planItem.request_snapshot?.note || "",
    shipping_instructions: planItem.shipping_instructions || {
      raw_note: planItem.request_snapshot?.note || "",
      requires_manual_pickup_shift: false,
      requested_pickup_shift_note: "",
    },
    request_snapshot: planItem.request_snapshot,
    product_matches: planItem.product_matches || [],
    customer_match: planItem.customer_match,
    browser_steps: buildBrowserStepsFromPlanLike(planItem),
    warnings: [
      "Execution bundle was rebuilt from queue + processing plan because no fresh worker bundle was available.",
      "Do not choose pickup shift unless the admin note explicitly requests it.",
    ],
  };
}

function buildExecutionPlan(bundle) {
  return {
    schema: "tq-sapo-phone-order-execution-plan/v1",
    exported_at: new Date().toISOString(),
    request_id: bundle.request_id,
    execution_mode: bundle.execution_mode,
    ready_for_browser_automation: !bundle.shipping_instructions?.requires_manual_pickup_shift,
    customer: bundle.customer,
    normalized_address: bundle.normalized_address,
    items: bundle.items,
    note: bundle.note,
    shipping_instructions: bundle.shipping_instructions,
    operational_defaults: bundle.operational_defaults,
    preflight: buildPreflight(bundle),
    browser_steps: bundle.browser_steps || [],
    manual_checkpoints: buildManualCheckpoints(bundle),
    record_commands: buildRecordCommands(bundle),
    warnings: bundle.warnings || [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workerOutput = await readJsonOrDefault(storePaths.workerOutputPath, {
    schema: "tq-sapo-phone-order-worker-output/v1",
    exported_at: "",
    dry_run: true,
    request_count: 0,
    bundles: [],
  });

  const bundles = Array.isArray(workerOutput.bundles) ? workerOutput.bundles : [];
  let bundle = args.fromState
    ? null
    : args.requestId
      ? bundles.find((item) => item.request_id === args.requestId)
      : bundles[0];

  if (!bundle) {
    const state = await loadPhoneOrderState();
    const fallbackRequestId =
      args.requestId ||
      state.statusPayload.requests?.find((entry) => entry.status === "ready")?.request_id ||
      state.planPayload.items?.find((item) => item.status === "ready")?.request_id ||
      "";

    if (fallbackRequestId) {
      bundle = rebuildBundleFromState(
        args,
        findQueueRequest(state.queuePayload, fallbackRequestId),
        findPlanItem(state.planPayload, fallbackRequestId),
        findStatusEntry(state.statusPayload, fallbackRequestId),
      );
    }
  }

  if (!bundle) {
    throw new Error(
      args.requestId
        ? `Request not found in worker output: ${args.requestId}`
        : "No worker bundle found. Run scripts/run-phone-order-worker.mjs first.",
    );
  }

  const executionPlan = buildExecutionPlan(bundle);
  await writeJson(storePaths.executionPlanPath, executionPlan);

  await appendWorkerLog({
    request_id: bundle.request_id,
    event_type: "execution_plan_prepared",
    execution_mode: bundle.execution_mode,
  });

  console.log(`Prepared browser execution plan for ${bundle.request_id} at ${storePaths.executionPlanPath}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
