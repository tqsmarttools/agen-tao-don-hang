import { spawn } from "node:child_process";
import {
  appendWorkerLog,
  findPlanItem,
  findQueueRequest,
  findStatusEntry,
  isTerminalExecutionStatus,
  loadPhoneOrderState,
  storePaths,
  updateQueueRequest,
  upsertStatusEntry,
  writeJson,
} from "./lib/phone-order-store.mjs";
import { syncRequestToSharedInbox } from "./lib/shared-inbox-sync.mjs";

function parseArgs(argv) {
  const args = {
    limit: 1,
    includeFailed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit") {
      args.limit = Math.max(1, Number(argv[++index] || 1));
    } else if (arg === "--include-failed") {
      args.includeFailed = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function effectiveStatus(planItem, statusEntry, queueRequest) {
  return queueRequest?.status || statusEntry?.status || planItem?.status || "";
}

function isReadyForSubmit(planItem, statusEntry, queueRequest, options = {}) {
  if (!planItem || planItem.status !== "ready") {
    return false;
  }

  if (isTerminalExecutionStatus(queueRequest?.execution_result?.status)) {
    return false;
  }

  const status = effectiveStatus(planItem, statusEntry, queueRequest);
  if (status === "failed") {
    return Boolean(options.includeFailed);
  }

  return status === "ready" || status === "pending_ai" || status === "";
}

function pickReadyRequests(state, limit, options = {}) {
  const requests = Array.isArray(state.queuePayload.requests) ? state.queuePayload.requests : [];
  const sorted = [...requests].sort((left, right) =>
    String(left.requested_at || "").localeCompare(String(right.requested_at || "")),
  );

  const selected = [];
  for (const queueRequest of sorted) {
    const planItem = findPlanItem(state.planPayload, queueRequest.request_id);
    const statusEntry = findStatusEntry(state.statusPayload, queueRequest.request_id);
    if (!isReadyForSubmit(planItem, statusEntry, queueRequest, options)) {
      continue;
    }

    selected.push(queueRequest.request_id);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

async function runNodeScript(scriptPath, scriptArgs) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
    });
    let stdoutBuffer = "";
    let stderrBuffer = "";

    child.stdout.on("data", (chunk) => {
      const text = String(chunk || "");
      stdoutBuffer += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk || "");
      stderrBuffer += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const firstErrorLine = stderrBuffer
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        [0];
      const lastOutputLine = stdoutBuffer
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-1)[0];

      reject(
        new Error(
          firstErrorLine ||
            lastOutputLine ||
            `${scriptPath} exited with code ${code}`,
        ),
      );
    });
  });
}

async function markFailed(requestId, message) {
  const state = await loadPhoneOrderState();
  const queueRequest = findQueueRequest(state.queuePayload, requestId);
  const statusEntry = findStatusEntry(state.statusPayload, requestId);

  if (!queueRequest) {
    return;
  }

  const now = new Date().toISOString();
  updateQueueRequest(state.queuePayload, requestId, {
    status: "failed",
    updated_at: now,
    message,
    last_error: message,
  });

  upsertStatusEntry(state.statusPayload, {
    request_id: requestId,
    status: "failed",
    updated_at: now,
    customer_name: queueRequest.customer?.name || statusEntry?.customer_name || "",
    customer_phone: queueRequest.customer?.phone || statusEntry?.customer_phone || "",
    message,
  });

  await appendWorkerLog({
    request_id: requestId,
    event_type: "omni_session_queue_failed",
    note: message,
  });

  await writeJson(storePaths.queuePath, state.queuePayload);
  await writeJson(storePaths.statusPath, state.statusPayload);
  await syncRequestToSharedInbox(queueRequest, {
    source: "omni-session-order-failed",
  }).catch(() => {});
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = await loadPhoneOrderState();
  const requestIds = pickReadyRequests(state, args.limit, {
    includeFailed: args.includeFailed,
  });

  if (requestIds.length === 0) {
    console.log("No ready requests available for Omni session processing.");
    return;
  }

  const summary = [];

  for (const requestId of requestIds) {
    try {
      await runNodeScript("scripts/create-sapo-omni-order-from-request.mjs", [
        "--request-id",
        requestId,
        "--submit",
      ]);

      summary.push({
        request_id: requestId,
        outcome: "created",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markFailed(requestId, message);
      summary.push({
        request_id: requestId,
        outcome: "failed",
        message,
      });
    }
  }

  console.log(JSON.stringify({ ok: true, processed: summary }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
