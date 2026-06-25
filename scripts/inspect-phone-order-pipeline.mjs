import {
  findPlanItem,
  findQueueRequest,
  findStatusEntry,
  loadPhoneOrderState,
  readJsonOrDefault,
  storePaths,
} from "./lib/phone-order-store.mjs";

function parseArgs(argv) {
  const args = {
    requestId: "",
    latest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--request-id") {
      args.requestId = argv[++index] || "";
    } else if (arg === "--latest") {
      args.latest = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function sortByRequestedAt(requests) {
  return [...requests].sort((left, right) =>
    String(right.requested_at || "").localeCompare(String(left.requested_at || "")),
  );
}

function chooseRequestId(args, inboxPayload, queuePayload) {
  if (args.requestId) {
    return args.requestId;
  }

  const inboxRequests = Array.isArray(inboxPayload.requests) ? inboxPayload.requests : [];
  const queueRequests = Array.isArray(queuePayload.requests) ? queuePayload.requests : [];
  const latestInbox = sortByRequestedAt(inboxRequests)[0];
  const latestQueue = sortByRequestedAt(queueRequests)[0];

  return latestInbox?.request_id || latestQueue?.request_id || "";
}

function summarizeRequest(request) {
  if (!request) {
    return null;
  }

  return {
    request_id: request.request_id,
    status: request.status || "",
    requested_at: request.requested_at || "",
    updated_at: request.updated_at || "",
    customer: request.customer || {},
    address: request.address || {},
    order_total_including_shipping: request.order_total_including_shipping || 0,
    item_count: Array.isArray(request.items) ? request.items.length : 0,
    items: Array.isArray(request.items)
      ? request.items.map((item) => ({
          variant_id: item.variant_id,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
        }))
      : [],
    note: request.note || "",
  };
}

function summarizePlanItem(planItem) {
  if (!planItem) {
    return null;
  }

  return {
    request_id: planItem.request_id,
    status: planItem.status,
    blockers: planItem.blockers || [],
    notes: planItem.notes || [],
    customer_match: planItem.customer_match || null,
    normalized_address: planItem.normalized_address || null,
    product_matches: planItem.product_matches || [],
    shipping_instructions: planItem.shipping_instructions || null,
    updated_at: planItem.updated_at || "",
  };
}

function summarizeStatusEntry(statusEntry) {
  if (!statusEntry) {
    return null;
  }

  return {
    request_id: statusEntry.request_id,
    status: statusEntry.status,
    updated_at: statusEntry.updated_at || "",
    customer_name: statusEntry.customer_name || "",
    customer_phone: statusEntry.customer_phone || "",
    message: statusEntry.message || "",
  };
}

function summarizeExecutionPlan(executionPlan) {
  if (!executionPlan) {
    return null;
  }

  return {
    request_id: executionPlan.request_id,
    execution_mode: executionPlan.execution_mode,
    ready_for_browser_automation: executionPlan.ready_for_browser_automation,
    browser_step_count: Array.isArray(executionPlan.browser_steps)
      ? executionPlan.browser_steps.length
      : 0,
    browser_steps: Array.isArray(executionPlan.browser_steps)
      ? executionPlan.browser_steps.map((step, index) => ({
          order: index + 1,
          action: step.action,
        }))
      : [],
  };
}

function summarizeExecutorPayload(payload) {
  if (!payload || !Array.isArray(payload.step_checklist)) {
    return null;
  }

  return {
    request_id: payload.request_id,
    progress: payload.progress || null,
    next_step:
      payload.step_checklist.find((step) => !step.completed && !step.failed) || null,
    failed_steps: payload.step_checklist.filter((step) => step.failed).map((step) => ({
      order: step.order,
      action: step.action,
      operator_note: step.operator_note || "",
    })),
  };
}

function computeLatency(requestedAt, comparedAt) {
  const start = Date.parse(requestedAt || "");
  const end = Date.parse(comparedAt || "");
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return Math.max(0, end - start);
}

function formatMs(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  return `${(value / 1000).toFixed(1)} s`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = await loadPhoneOrderState();
  const inboxPayload = await readJsonOrDefault(storePaths.dataDir + "/phone-order-inbox.json", {
    requests: [],
  });
  const executionPlan = await readJsonOrDefault(storePaths.executionPlanPath, null);
  const executorPayload = await readJsonOrDefault(storePaths.workerOutputPath, null);

  const requestId = chooseRequestId(args, inboxPayload, state.queuePayload);
  if (!requestId) {
    throw new Error("No request found in inbox or queue.");
  }

  const inboxRequest = (Array.isArray(inboxPayload.requests) ? inboxPayload.requests : []).find(
    (request) => request.request_id === requestId,
  ) || null;
  const queueRequest = findQueueRequest(state.queuePayload, requestId);
  const planItem = findPlanItem(state.planPayload, requestId);
  const statusEntry = findStatusEntry(state.statusPayload, requestId);

  const report = {
    request_id: requestId,
    inbox_request: summarizeRequest(inboxRequest),
    queue_request: summarizeRequest(queueRequest),
    processing_plan: summarizePlanItem(planItem),
    status_entry: summarizeStatusEntry(statusEntry),
    execution_plan:
      executionPlan?.request_id === requestId
        ? summarizeExecutionPlan(executionPlan)
        : null,
    executor_payload:
      executorPayload?.request_id === requestId
        ? summarizeExecutorPayload(executorPayload)
        : null,
    timing: {
      inbox_seen_after: formatMs(
        computeLatency(inboxRequest?.requested_at, inboxPayload.exported_at),
      ),
      queue_written_after: formatMs(
        computeLatency(queueRequest?.requested_at, state.queuePayload.exported_at),
      ),
      plan_built_after: formatMs(
        computeLatency(queueRequest?.requested_at, planItem?.updated_at),
      ),
      status_updated_after: formatMs(
        computeLatency(queueRequest?.requested_at, statusEntry?.updated_at),
      ),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
