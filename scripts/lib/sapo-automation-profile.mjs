import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..", "..");
const localAppDataDir =
  process.env.LOCALAPPDATA || "C:/Users/Admin/AppData/Local";

export const automationProfileDir = path.join(
  localAppDataDir,
  "TQSmarttools",
  "sapo-automation-profile",
);
export const sapoCreateOrderUrl =
  "https://thien-quang-smart-tools.mysapogo.com/admin/orders/create";
export const chromeRemoteDebugSettingsUrl = "chrome://inspect/#remote-debugging";

export async function ensureAutomationProfileDir() {
  await mkdir(automationProfileDir, { recursive: true });
  return automationProfileDir;
}

export function automationChromeLaunchArgs(extraUrls = []) {
  return [
    `--user-data-dir=${automationProfileDir}`,
    "--remote-debugging-port=9223",
    sapoCreateOrderUrl,
    ...extraUrls,
  ];
}

export function automationProfileSummary() {
  return {
    workspaceRoot,
    automationProfileDir,
    sapoCreateOrderUrl,
    chromeRemoteDebugSettingsUrl,
    profileExists: existsSync(automationProfileDir),
  };
}
