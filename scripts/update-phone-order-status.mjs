import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..");
const statusPath = path.join(workspaceRoot, "data", "ai-request-status.json");

function parseArgs(argv) {
  const args = {
    requestId: "",
    status: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--request-id") {
      args.requestId = argv[++index] || "";
    } else if (arg === "--status") {
      args.status = argv[++index] || "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.requestId || !args.status) {
    throw new Error("Usage: node scripts/update-phone-order-status.mjs --request-id <id> --status <status>");
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = existsSync(statusPath)
    ? JSON.parse((await readFile(statusPath, "utf8")).replace(/^\uFEFF/, ""))
    : { schema: "tq-sapo-phone-order-status/v1", exported_at: "", request_count: 0, requests: [] };

  const requests = Array.isArray(payload.requests) ? payload.requests : [];
  const existing = requests.find((request) => request.request_id === args.requestId);

  if (existing) {
    existing.status = args.status;
    existing.updated_at = new Date().toISOString();
  } else {
    requests.push({
      request_id: args.requestId,
      status: args.status,
      updated_at: new Date().toISOString(),
      customer_name: "",
      customer_phone: "",
    });
  }

  payload.exported_at = new Date().toISOString();
  payload.request_count = requests.length;
  payload.requests = requests;

  await writeFile(statusPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Updated ${args.requestId} -> ${args.status}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
