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

function parseArgs(argv) {
  const args = {
    requestId: "",
    status: "",
    message: "",
    sapoOrderCode: "",
    sapoOrderUrl: "",
    shipmentCode: "",
    carrier: "",
    partnerStatus: "",
    operatorNote: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--request-id") {
      args.requestId = argv[++index] || "";
    } else if (arg === "--status") {
      args.status = argv[++index] || "";
    } else if (arg === "--message") {
      args.message = argv[++index] || "";
    } else if (arg === "--sapo-order-code") {
      args.sapoOrderCode = argv[++index] || "";
    } else if (arg === "--sapo-order-url") {
      args.sapoOrderUrl = argv[++index] || "";
    } else if (arg === "--shipment-code") {
      args.shipmentCode = argv[++index] || "";
    } else if (arg === "--carrier") {
      args.carrier = argv[++index] || "";
    } else if (arg === "--partner-status") {
      args.partnerStatus = argv[++index] || "";
    } else if (arg === "--operator-note") {
      args.operatorNote = argv[++index] || "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.requestId || !args.status) {
    throw new Error(
      "Usage: node scripts/record-phone-order-result.mjs --request-id <id> --status <created|failed|need_more_info> [options]",
    );
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = await loadPhoneOrderState();
  const queueRequest = findQueueRequest(state.queuePayload, args.requestId);
  const planItem = findPlanItem(state.planPayload, args.requestId);
  const statusEntry = findStatusEntry(state.statusPayload, args.requestId);

  if (!queueRequest || !planItem) {
    throw new Error(`Request not found: ${args.requestId}`);
  }

  const now = new Date().toISOString();
  const result = {
    status: args.status,
    recorded_at: now,
    sapo_order_code: args.sapoOrderCode,
    sapo_order_url: args.sapoOrderUrl,
    shipment_code: args.shipmentCode,
    carrier: args.carrier,
    partner_status: args.partnerStatus,
    operator_note: args.operatorNote,
  };

  updateQueueRequest(state.queuePayload, args.requestId, {
    status: args.status,
    updated_at: now,
    execution_result: result,
  });

  upsertStatusEntry(state.statusPayload, {
    request_id: args.requestId,
    status: args.status,
    updated_at: now,
    customer_name: queueRequest.customer?.name || statusEntry?.customer_name || "",
    customer_phone: queueRequest.customer?.phone || statusEntry?.customer_phone || "",
    message:
      args.message ||
      (args.status === "created"
        ? `Created in Sapo${args.sapoOrderCode ? `: ${args.sapoOrderCode}` : ""}.`
        : `Execution finished with status: ${args.status}.`),
  });

  await appendWorkerLog({
    request_id: args.requestId,
    event_type: "execution_result_recorded",
    result,
  });

  await writeJson(storePaths.queuePath, state.queuePayload);
  await writeJson(storePaths.statusPath, state.statusPayload);

  const outputPayload = {
    schema: "tq-sapo-phone-order-result/v1",
    exported_at: now,
    request_id: args.requestId,
    request_status_before_record: statusEntry?.status || planItem.status || "",
    result,
  };

  await writeJson(storePaths.workerOutputPath, outputPayload);

  console.log(`Recorded result for ${args.requestId} -> ${args.status}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
