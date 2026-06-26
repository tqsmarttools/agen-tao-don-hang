import { spawn } from "node:child_process";
import {
  findPlanItem,
  findQueueRequest,
  findStatusEntry,
  appendWorkerLog,
  isTerminalExecutionStatus,
  loadPhoneOrderState,
  readJsonOrDefault,
  storePaths,
  updateQueueRequest,
  upsertStatusEntry,
  writeJson,
} from "./lib/phone-order-store.mjs";
import { syncRequestToSharedInbox } from "./lib/shared-inbox-sync.mjs";

function parseArgs(argv) {
  const args = {
    limit: 1,
    maxSteps: 10,
    submit: false,
    headless: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit") {
      args.limit = Math.max(1, Number(argv[++index] || 1));
    } else if (arg === "--max-steps") {
      args.maxSteps = Math.max(1, Number(argv[++index] || 10));
    } else if (arg === "--submit") {
      args.submit = true;
    } else if (arg === "--headless") {
      args.headless = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.submit && args.maxSteps > 10) {
    args.maxSteps = 10;
  }

  return args;
}

function effectiveStatus(planItem, statusEntry, queueRequest) {
  return queueRequest?.status || statusEntry?.status || planItem?.status || "";
}

function isAlreadyCompleted(queueRequest, statusEntry) {
  return (
    isTerminalExecutionStatus(queueRequest?.execution_result?.status) ||
    isTerminalExecutionStatus(statusEntry?.status)
  );
}

function pickReadyRequests(state, limit) {
  const requests = Array.isArray(state.queuePayload.requests) ? state.queuePayload.requests : [];
  const sorted = [...requests].sort((left, right) =>
    String(left.requested_at || "").localeCompare(String(right.requested_at || "")),
  );

  const selected = [];
  for (const queueRequest of sorted) {
    const planItem = findPlanItem(state.planPayload, queueRequest.request_id);
    const statusEntry = findStatusEntry(state.statusPayload, queueRequest.request_id);
    const status = effectiveStatus(planItem, statusEntry, queueRequest);

    if (!planItem || planItem.status !== "ready") {
      continue;
    }

    if (isAlreadyCompleted(queueRequest, statusEntry)) {
      continue;
    }

    if (!["ready", "pending_ai", ""].includes(status)) {
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

async function executionProgressFor(requestId) {
  const payload = await readJsonOrDefault(storePaths.workerOutputPath, null);
  if (!payload || payload.request_id !== requestId) {
    return null;
  }

  return payload.progress || null;
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
    event_type: "sequential_queue_runner_failed",
    note: message,
  });

  await writeJson(storePaths.queuePath, state.queuePayload);
  await writeJson(storePaths.statusPath, state.statusPayload);
  await syncRequestToSharedInbox(queueRequest, {
    source: "browser-sequential-order-failed",
  }).catch(() => {});
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = await loadPhoneOrderState();
  const requestIds = pickReadyRequests(state, args.limit);

  if (requestIds.length === 0) {
    console.log("No ready requests available for sequential processing.");
    return;
  }

  const summary = [];

  for (const requestId of requestIds) {
    try {
      await runNodeScript("scripts/run-phone-order-worker.mjs", [
        "--request-id",
        requestId,
        "--limit",
        "1",
      ]);

      await runNodeScript("scripts/prepare-phone-order-execution.mjs", [
        "--request-id",
        requestId,
        "--from-state",
      ]);

      const liveArgs = [
        "scripts/run-phone-order-playwright-live.mjs",
        "--request-id",
        requestId,
        "--reset",
        "--max-steps",
        String(args.submit ? 11 : args.maxSteps),
      ];

      if (args.headless) {
        liveArgs.push("--headless");
      }

      await runNodeScript(liveArgs[0], liveArgs.slice(1));

      summary.push({
        request_id: requestId,
        outcome: "processed",
        progress: await executionProgressFor(requestId),
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
