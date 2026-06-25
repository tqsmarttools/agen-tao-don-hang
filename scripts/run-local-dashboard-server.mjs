import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..");
const siteRoot = path.join(workspaceRoot, "site");
const dataDir = path.join(workspaceRoot, "data");
const inboxPath = path.join(dataDir, "phone-order-inbox.json");
const queuePath = path.join(dataDir, "ai-requests.json");
const port = Number(process.env.TQ_LOCAL_DASHBOARD_PORT || 8789);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon",
};

async function readJsonOrDefault(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
}

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function mergeRequests(existingRequests, incomingRequests) {
  const byId = new Map(existingRequests.map((request) => [request.request_id, request]));
  for (const request of incomingRequests) {
    byId.set(request.request_id, {
      ...byId.get(request.request_id),
      ...request,
    });
  }

  return [...byId.values()].sort((left, right) =>
    String(left.requested_at || "").localeCompare(String(right.requested_at || "")),
  );
}

async function handleLocalInboxPost(req, res) {
  let rawBody = "";
  for await (const chunk of req) {
    rawBody += String(chunk);
  }

  const body = JSON.parse(rawBody || "{}");
  const payload = body.payload || {};
  const incomingRequests = Array.isArray(payload.requests) ? payload.requests : [];

  const currentInbox = await readJsonOrDefault(inboxPath, {
    schema: "tq-sapo-phone-order-request-queue/v1",
    exported_at: "",
    request_count: 0,
    requests: [],
  });

  const mergedRequests = mergeRequests(currentInbox.requests || [], incomingRequests);
  const nextInbox = {
    schema: "tq-sapo-phone-order-request-queue/v1",
    exported_at: new Date().toISOString(),
    request_count: mergedRequests.length,
    requests: mergedRequests,
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(inboxPath, `${JSON.stringify(nextInbox, null, 2)}\n`, "utf8");

  jsonResponse(res, 200, {
    ok: true,
    mode: "local_inbox",
    request_count: incomingRequests.length,
    stored_request_count: mergedRequests.length,
    updated_at: nextInbox.exported_at,
  });
}

async function handleLocalInboxGet(_req, res) {
  const inboxPayload = await readJsonOrDefault(inboxPath, {
    schema: "tq-sapo-phone-order-request-queue/v1",
    exported_at: "",
    request_count: 0,
    requests: [],
  });
  const queuePayload = await readJsonOrDefault(queuePath, {
    schema: "tq-sapo-phone-order-request-queue/v1",
    exported_at: "",
    request_count: 0,
    requests: [],
  });

  const inboxRequests = Array.isArray(inboxPayload.requests) ? inboxPayload.requests : [];
  const queueRequests = Array.isArray(queuePayload.requests) ? queuePayload.requests : [];
  const queueById = new Map(queueRequests.map((request) => [request.request_id, request]));

  const mergedRequests = inboxRequests.map((request) => {
    const queueRequest = queueById.get(request.request_id);
    if (!queueRequest) {
      return request;
    }

    return {
      ...request,
      status: queueRequest.status || request.status,
      updated_at: queueRequest.updated_at || request.updated_at,
      execution_result: queueRequest.execution_result || request.execution_result,
    };
  });

  jsonResponse(res, 200, {
    schema: "tq-sapo-phone-order-request-queue/v1",
    exported_at:
      queuePayload.exported_at || inboxPayload.exported_at || new Date().toISOString(),
    request_count: mergedRequests.length,
    requests: mergedRequests,
  });
}

async function handleStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let filePath = path.join(siteRoot, urlPath === "/" ? "/apps/dashboard/index.html" : urlPath);

  if (!filePath.startsWith(siteRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const contents = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(contents);
  } catch {
    const fallbackPath = path.join(filePath, "index.html");
    try {
      const contents = await readFile(fallbackPath);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(contents);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/__local_ai_inbox") {
      await handleLocalInboxPost(req, res);
      return;
    }

    if (req.method === "GET" && req.url === "/__local_ai_inbox") {
      await handleLocalInboxGet(req, res);
      return;
    }

    await handleStatic(req, res);
  } catch (error) {
    jsonResponse(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`LOCAL_DASHBOARD_SERVER http://127.0.0.1:${port}/apps/dashboard/index.html`);
});
