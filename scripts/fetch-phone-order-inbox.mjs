import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..");
const dataDir = path.join(workspaceRoot, "data");
const configPath = path.join(dataDir, "phone-order-config.json");
const outputPath = path.join(dataDir, "phone-order-inbox.json");

async function loadConfig() {
  if (!existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}`);
  }
  return JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
}

async function main() {
  const config = await loadConfig();
  if (!config.inbox_url || !config.inbox_key) {
    throw new Error("Config requires inbox_url and inbox_key.");
  }

  const joiner = config.inbox_url.includes("?") ? "&" : "?";
  const response = await fetch(`${config.inbox_url}${joiner}inbox_key=${encodeURIComponent(config.inbox_key)}`);
  if (!response.ok) {
    throw new Error(`Inbox fetch failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  await mkdir(dataDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Fetched ${payload.request_count || 0} requests to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
