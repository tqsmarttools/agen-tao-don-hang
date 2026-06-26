import { loadPlaywright } from "./lib/load-playwright.mjs";
import {
  automationProfileDir,
  ensureAutomationProfileDir,
  sapoCreateOrderUrl,
} from "./lib/sapo-automation-profile.mjs";
import {
  appendWorkerLog,
  findStatusEntry,
  loadPhoneOrderState,
  updateQueueRequest,
  upsertStatusEntry,
  writeJson,
  storePaths,
} from "./lib/phone-order-store.mjs";
import { syncRequestToSharedInbox } from "./lib/shared-inbox-sync.mjs";

function parseOrderIdFromUrl(url) {
  const match = String(url || "").match(/\/admin\/orders\/(\d+)/i);
  return match ? Number(match[1]) : 0;
}

async function fetchOrderDetails(page, orderId) {
  const baseUrl = new URL(sapoCreateOrderUrl).origin;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await page.evaluate(
        async ({ orderId, baseUrl }) => {
          const response = await fetch(`${baseUrl}/admin/orders/${orderId}.json`, {
            method: "GET",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "X-Sapo-LocationId": "680305",
            },
          });

          const text = await response.text();
          let payload = null;
          try {
            payload = text ? JSON.parse(text) : null;
          } catch {
            payload = null;
          }

          return {
            ok: response.ok,
            status: response.status,
            order: payload?.order || null,
          };
        },
        { orderId, baseUrl },
      );

      if (!result?.ok || !result?.order) {
        throw new Error(`Cannot read Sapo order ${orderId}: HTTP ${result?.status ?? "unknown"}`);
      }

      return result.order;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Execution context was destroyed/i.test(message) || attempt === 1) {
        throw error;
      }

      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
  }

  throw new Error(`Cannot read Sapo order ${orderId}.`);
}

function desiredStatusFromSapo(order) {
  const status = String(order?.status || "").trim().toLowerCase();
  if (status === "draft") {
    return "waiting_approval";
  }
  if (status === "finalized") {
    return "created";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "";
}

function buildMessage(nextStatus, orderCode) {
  if (nextStatus === "waiting_approval") {
    return `Da tao don cho duyet tren Sapo: ${orderCode}`;
  }
  if (nextStatus === "created") {
    return `Admin da duyet don tren Sapo: ${orderCode}`;
  }
  if (nextStatus === "cancelled") {
    return `Don da bi huy tren Sapo: ${orderCode}`;
  }
  return `Trang thai Sapo da thay doi: ${orderCode}`;
}

async function main() {
  const state = await loadPhoneOrderState();
  const requests = Array.isArray(state.queuePayload.requests) ? state.queuePayload.requests : [];
  const waitingRequests = requests.filter(
    (request) => String(request?.execution_result?.status || "").trim() === "waiting_approval",
  );

  if (waitingRequests.length === 0) {
    console.log("No waiting_approval requests to reconcile from Sapo.");
    return;
  }

  await ensureAutomationProfileDir();
  const playwright = await loadPlaywright();
  const context = await playwright.chromium.launchPersistentContext(automationProfileDir, {
    headless: true,
  });

  const changed = [];

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(sapoCreateOrderUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);

    for (const request of waitingRequests) {
      const orderId = parseOrderIdFromUrl(request.execution_result?.sapo_order_url);
      if (!orderId) {
        continue;
      }

      const order = await fetchOrderDetails(page, orderId);
      const nextStatus = desiredStatusFromSapo(order);
      if (!nextStatus || nextStatus === "waiting_approval") {
        continue;
      }

      const now = new Date().toISOString();
      const message = buildMessage(nextStatus, order.code);
      const statusEntry = findStatusEntry(state.statusPayload, request.request_id);

      updateQueueRequest(state.queuePayload, request.request_id, {
        status: nextStatus,
        updated_at: now,
        message,
        last_error: nextStatus === "cancelled" ? "" : request.last_error || "",
        execution_result: {
          ...(request.execution_result || {}),
          status: nextStatus,
          recorded_at: now,
          sapo_order_code: order.code,
          sapo_order_url: new URL(`/admin/orders/${order.id}`, sapoCreateOrderUrl).href,
          operator_note:
            nextStatus === "created"
              ? "Admin approved the draft order in Sapo."
              : "Order was cancelled in Sapo.",
        },
      });

      upsertStatusEntry(state.statusPayload, {
        request_id: request.request_id,
        status: nextStatus,
        updated_at: now,
        customer_name: request.customer?.name || statusEntry?.customer_name || "",
        customer_phone: request.customer?.phone || statusEntry?.customer_phone || "",
        message,
      });

      await appendWorkerLog({
        request_id: request.request_id,
        event_type: "sapo_waiting_approval_reconciled",
        sapo_order_id: order.id,
        sapo_order_code: order.code,
        sapo_status: order.status,
        next_status: nextStatus,
      });

      changed.push(request.request_id);
    }
  } finally {
    await context.close().catch(() => {});
  }

  if (changed.length === 0) {
    console.log("No waiting_approval requests changed on Sapo.");
    return;
  }

  await writeJson(storePaths.queuePath, state.queuePayload);
  await writeJson(storePaths.statusPath, state.statusPayload);

  for (const requestId of changed) {
    const request = state.queuePayload.requests.find((entry) => entry.request_id === requestId);
    if (request) {
      await syncRequestToSharedInbox(request, {
        source: "sapo-status-reconcile",
      }).catch(() => {});
    }
  }

  console.log(JSON.stringify({ ok: true, changed }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
