import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..", "..");
const configPath = path.join(workspaceRoot, "data", "phone-order-config.json");

async function readPhoneOrderConfigOrNull() {
  if (!existsSync(configPath)) {
    return null;
  }

  return JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
}

export async function syncRequestToSharedInbox(request, { source = "phone-order-sync" } = {}) {
  const config = await readPhoneOrderConfigOrNull();
  if (!config?.inbox_url || !config?.inbox_key) {
    return { ok: false, skipped: true, reason: "missing_inbox_config" };
  }

  const response = await fetch(config.inbox_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inbox_key: config.inbox_key,
      source,
      payload: {
        schema: "tq-sapo-phone-order-request-queue/v1",
        exported_at: new Date().toISOString(),
        request_count: 1,
        requests: [request],
      },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Shared inbox sync failed: HTTP ${response.status} ${text}`);
  }

  return { ok: true, body: text };
}
