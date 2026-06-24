import {
  appendWorkerLog,
  findPlanItem,
  findQueueRequest,
  findStatusEntry,
  loadPhoneOrderState,
  storePaths,
  updateQueueRequest,
  upsertStatusEntry,
  writeJson,
} from "./lib/phone-order-store.mjs";
import { buildBrowserStepsFromPlanLike } from "./lib/phone-order-browser-steps.mjs";

function parseArgs(argv) {
  const args = {
    requestId: "",
    limit: 1,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--request-id") {
      args.requestId = argv[++index] || "";
    } else if (arg === "--limit") {
      args.limit = Math.max(1, Number(argv[++index] || 1));
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function effectiveStatus(planItem, statusEntry, queueRequest) {
  return statusEntry?.status || queueRequest?.status || planItem?.status || "";
}

function isReadyForExecution(planItem, statusEntry, queueRequest) {
  if (!planItem || planItem.status !== "ready") {
    return false;
  }

  const status = effectiveStatus(planItem, statusEntry, queueRequest);
  return status === "ready" || status === "pending_ai" || status === "";
}

function buildExecutionBundle(planItem, queueRequest, statusEntry) {
  const request = planItem.request_snapshot;
  return {
    request_id: planItem.request_id,
    claimed_at: new Date().toISOString(),
    source_status: effectiveStatus(planItem, statusEntry, queueRequest),
    execution_mode: "chrome-sapo-script",
    operational_defaults: {
      preferred_carrier: "GHN",
      shipping_fee_payer: "shop",
      pickup_shift_behavior: "leave_blank_unless_requested",
      cod_amount: request.order_total_including_shipping || 0,
      declared_package_value: request.order_total_including_shipping || 0,
    },
    customer: {
      request_name: request.customer?.name || "",
      phone: request.customer?.phone || "",
      existing_customer_match: planItem.customer_match,
    },
    normalized_address: planItem.normalized_address,
    items: planItem.product_matches || [],
    note: request.note || "",
    shipping_instructions: planItem.shipping_instructions || {
      raw_note: request.note || "",
      requires_manual_pickup_shift: false,
      requested_pickup_shift_note: "",
    },
    browser_steps: buildBrowserStepsFromPlanLike(planItem),
    warnings: [
      "Use the validated Sapo create-order flow from docs/real-world-findings.md.",
      "Do not choose pickup shift unless the admin note explicitly requests it.",
      "If GHN service selection is unavailable, stop and record a failed result instead of guessing another carrier.",
    ],
  };
}

function pickRequests(args, queuePayload, planPayload, statusPayload) {
  const requests = Array.isArray(queuePayload.requests) ? queuePayload.requests : [];
  const sorted = [...requests].sort((left, right) =>
    String(left.requested_at || "").localeCompare(String(right.requested_at || "")),
  );

  const selected = [];
  for (const queueRequest of sorted) {
    const requestId = queueRequest.request_id;
    if (args.requestId && requestId !== args.requestId) {
      continue;
    }

    const planItem = findPlanItem(planPayload, requestId);
    const statusEntry = findStatusEntry(statusPayload, requestId);
    if (!isReadyForExecution(planItem, statusEntry, queueRequest)) {
      continue;
    }

    selected.push({
      requestId,
      queueRequest,
      planItem,
      statusEntry,
    });

    if (selected.length >= args.limit) {
      break;
    }
  }

  return selected;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = await loadPhoneOrderState();
  const selected = pickRequests(args, state.queuePayload, state.planPayload, state.statusPayload);

  if (selected.length === 0) {
    console.log("No ready requests available for script execution.");
    return;
  }

  const bundles = selected.map(({ queueRequest, planItem, statusEntry }) =>
    buildExecutionBundle(planItem, queueRequest, statusEntry),
  );

  if (!args.dryRun) {
    for (const bundle of bundles) {
      updateQueueRequest(state.queuePayload, bundle.request_id, {
        status: "processing_script",
        updated_at: new Date().toISOString(),
      });

      upsertStatusEntry(state.statusPayload, {
        request_id: bundle.request_id,
        status: "processing_script",
        updated_at: new Date().toISOString(),
        customer_name: bundle.customer.request_name,
        customer_phone: bundle.customer.phone,
        message: "Claimed by script runner. Follow the generated execution bundle to create the order in Sapo.",
      });

      await appendWorkerLog({
        request_id: bundle.request_id,
        event_type: "claimed_for_execution",
        execution_mode: bundle.execution_mode,
      });
    }

    await writeJson(storePaths.queuePath, state.queuePayload);
    await writeJson(storePaths.statusPath, state.statusPayload);
  }

  const outputPayload = {
    schema: "tq-sapo-phone-order-worker-output/v1",
    exported_at: new Date().toISOString(),
    dry_run: args.dryRun,
    request_count: bundles.length,
    bundles,
  };

  await writeJson(storePaths.workerOutputPath, outputPayload);

  console.log(
    `${args.dryRun ? "Prepared" : "Claimed"} ${bundles.length} request(s). Output: ${storePaths.workerOutputPath}`,
  );
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
