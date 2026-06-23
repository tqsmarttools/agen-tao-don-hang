import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..");
const dataDir = path.join(workspaceRoot, "data");
const inboxPath = path.join(dataDir, "phone-order-inbox.json");
const queuePath = path.join(dataDir, "ai-requests.json");
const statusPath = path.join(dataDir, "ai-request-status.json");

async function readJsonOrDefault(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
}

function mergeRequests(existingRequests, inboxRequests) {
  const byId = new Map(existingRequests.map((request) => [request.request_id, request]));
  for (const request of inboxRequests) {
    byId.set(request.request_id, {
      ...byId.get(request.request_id),
      ...request,
    });
  }
  return [...byId.values()].sort((left, right) => String(left.requested_at).localeCompare(String(right.requested_at)));
}

function buildStatusPayload(requests) {
  return {
    schema: "tq-sapo-phone-order-status/v1",
    exported_at: new Date().toISOString(),
    request_count: requests.length,
    requests: requests.map((request) => ({
      request_id: request.request_id,
      status: request.status || "pending_ai",
      updated_at: request.updated_at || request.requested_at || new Date().toISOString(),
      customer_name: request.customer?.name || "",
      customer_phone: request.customer?.phone || "",
    })),
  };
}

async function main() {
  const inbox = await readJsonOrDefault(inboxPath, { requests: [] });
  const existingQueue = await readJsonOrDefault(queuePath, { requests: [] });
  const mergedRequests = mergeRequests(existingQueue.requests || [], inbox.requests || []);

  const queuePayload = {
    schema: "tq-sapo-phone-order-request-queue/v1",
    exported_at: new Date().toISOString(),
    request_count: mergedRequests.length,
    requests: mergedRequests,
  };

  const statusPayload = buildStatusPayload(mergedRequests);

  await mkdir(dataDir, { recursive: true });
  await writeFile(queuePath, `${JSON.stringify(queuePayload, null, 2)}\n`, "utf8");
  await writeFile(statusPath, `${JSON.stringify(statusPayload, null, 2)}\n`, "utf8");

  console.log(`Imported ${mergedRequests.length} requests into ${queuePath}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
