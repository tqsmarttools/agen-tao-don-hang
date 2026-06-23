import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE_URL = "https://online-gateway.ghn.vn/shiip/public-api";
const SHOP_ID = 5896298;
const credentialScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  ".codex",
  "mcp",
  "ghn-server",
  "credential.ps1",
);

export function readGhnToken() {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      credentialScript,
      "-Action",
      "get",
      "-Target",
      "Codex/GHN/API_TOKEN",
    ],
    { encoding: "utf8", windowsHide: true },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Cannot read GHN token.");
  }

  const token = result.stdout.trim();
  if (!token) {
    throw new Error("GHN token is empty.");
  }

  return token;
}

export async function ghnGet(apiPath, token) {
  const response = await fetch(`${BASE_URL}${apiPath}`, {
    method: "GET",
    headers: { Token: token },
  });
  const payload = await response.json();

  if (!response.ok || payload.code !== 200) {
    throw new Error(`GHN GET ${apiPath} failed: HTTP ${response.status}, API ${payload.code}, ${payload.message}`);
  }

  return payload.data;
}

export async function ghnPost(apiPath, body, token, includeShopId = false) {
  const headers = {
    "Content-Type": "application/json",
    Token: token,
  };

  if (includeShopId) {
    headers.ShopId = String(SHOP_ID);
  }

  const response = await fetch(`${BASE_URL}${apiPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json();

  if (!response.ok || payload.code !== 200) {
    throw new Error(`GHN POST ${apiPath} failed: HTTP ${response.status}, API ${payload.code}, ${payload.message}`);
  }

  return payload.data;
}

export function ghnShopId() {
  return SHOP_ID;
}
