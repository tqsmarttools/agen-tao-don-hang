import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..", "..");
const dataDir = path.join(workspaceRoot, "data");

export const storePaths = {
  dataDir,
  queuePath: path.join(dataDir, "ai-requests.json"),
  processingPlanPath: path.join(dataDir, "phone-order-processing-plan.json"),
  statusPath: path.join(dataDir, "ai-request-status.json"),
  executionPlanPath: path.join(dataDir, "phone-order-execution-plan.json"),
  executionNotesPath: path.join(dataDir, "phone-order-execution-notes.md"),
  workerOutputPath: path.join(dataDir, "phone-order-worker-output.json"),
  workerLogPath: path.join(dataDir, "phone-order-worker-log.json"),
};

function parseJsonLenient(rawText) {
  const sanitized = String(rawText || "").replace(/^\uFEFF/, "");

  try {
    return JSON.parse(sanitized);
  } catch {
    const trimmed = sanitized.trimEnd();
    for (let index = trimmed.length - 1; index >= 0; index -= 1) {
      const char = trimmed[index];
      if (char !== "}" && char !== "]") {
        continue;
      }

      const candidate = trimmed.slice(0, index + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        continue;
      }
    }

    throw new Error("Could not recover a valid JSON payload from the file contents.");
  }
}

export async function readJsonOrDefault(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }

  return parseJsonLenient(await readFile(filePath, "utf8"));
}

export async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function writeText(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf8");
}

export async function loadPhoneOrderState() {
  const queuePayload = await readJsonOrDefault(storePaths.queuePath, {
    schema: "tq-sapo-phone-order-request-queue/v1",
    exported_at: "",
    request_count: 0,
    requests: [],
  });
  const planPayload = await readJsonOrDefault(storePaths.processingPlanPath, {
    schema: "tq-sapo-phone-order-processing-plan/v1",
    exported_at: "",
    request_count: 0,
    items: [],
  });
  const statusPayload = await readJsonOrDefault(storePaths.statusPath, {
    schema: "tq-sapo-phone-order-status/v1",
    exported_at: "",
    request_count: 0,
    requests: [],
  });

  return {
    queuePayload,
    planPayload,
    statusPayload,
  };
}

export function findQueueRequest(queuePayload, requestId) {
  const requests = Array.isArray(queuePayload.requests) ? queuePayload.requests : [];
  return requests.find((request) => request.request_id === requestId) || null;
}

export function findPlanItem(planPayload, requestId) {
  const items = Array.isArray(planPayload.items) ? planPayload.items : [];
  return items.find((item) => item.request_id === requestId) || null;
}

export function findStatusEntry(statusPayload, requestId) {
  const requests = Array.isArray(statusPayload.requests) ? statusPayload.requests : [];
  return requests.find((request) => request.request_id === requestId) || null;
}

export function upsertStatusEntry(statusPayload, entry) {
  const requests = Array.isArray(statusPayload.requests) ? statusPayload.requests : [];
  const existing = requests.find((request) => request.request_id === entry.request_id);

  if (existing) {
    Object.assign(existing, entry);
  } else {
    requests.push(entry);
  }

  statusPayload.requests = requests;
  statusPayload.exported_at = new Date().toISOString();
  statusPayload.request_count = requests.length;
}

export function updateQueueRequest(queuePayload, requestId, patch) {
  const request = findQueueRequest(queuePayload, requestId);
  if (!request) {
    return null;
  }

  Object.assign(request, patch);
  queuePayload.exported_at = new Date().toISOString();
  queuePayload.request_count = Array.isArray(queuePayload.requests) ? queuePayload.requests.length : 0;
  return request;
}

export async function appendWorkerLog(event) {
  const payload = await readJsonOrDefault(storePaths.workerLogPath, {
    schema: "tq-sapo-phone-order-worker-log/v1",
    exported_at: "",
    event_count: 0,
    events: [],
  });

  const events = Array.isArray(payload.events) ? payload.events : [];
  events.push({
    ...event,
    logged_at: new Date().toISOString(),
  });

  payload.schema = "tq-sapo-phone-order-worker-log/v1";
  payload.exported_at = new Date().toISOString();
  payload.event_count = events.length;
  payload.events = events;

  await writeJson(storePaths.workerLogPath, payload);
}
