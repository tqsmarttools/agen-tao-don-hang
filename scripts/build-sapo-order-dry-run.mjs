import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..");
const dataDir = path.join(workspaceRoot, "data");
const processingPlanPath = path.join(dataDir, "phone-order-processing-plan.json");
const outputPath = path.join(dataDir, "sapo-order-dry-run.json");

async function readJsonOrDefault(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
}

function splitCustomerName(fullName) {
  const normalized = String(fullName || "").trim();
  if (!normalized) {
    return { first_name: "", last_name: "" };
  }

  const parts = normalized.split(/\s+/);
  if (parts.length === 1) {
    return { first_name: normalized, last_name: "" };
  }

  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts.at(-1) || "",
  };
}

function buildAddressBlock(request) {
  const customerName = request.customer?.name || "";
  const splitName = splitCustomerName(customerName);
  const address = request.address || {};

  return {
    first_name: splitName.first_name,
    last_name: splitName.last_name,
    phone: request.customer?.phone || "",
    address1: address.address_detail || "",
    ward: address.ward || "",
    district: address.district || "",
    province: address.province || "",
    country: "Vietnam",
    country_code: "VN",
    name: customerName,
  };
}

function buildDraftOrder(planItem) {
  const request = planItem.request_snapshot;
  const addressBlock = buildAddressBlock(request);

  return {
    request_id: planItem.request_id,
    status: planItem.status,
    dry_run: true,
    create_path: "sapo-api",
    order_candidate: {
      source_name: "phone",
      source: "manual_phone_order",
      financial_status: "pending",
      fulfillment_status: null,
      note: request.note || "",
      phone: request.customer?.phone || "",
      billing_address: addressBlock,
      shipping_address: addressBlock,
      line_items: planItem.product_matches.map((item) => ({
        variant_id: item.variant_id,
        quantity: item.quantity,
        title: item.matched_name,
        sku: item.sku,
      })),
      expected_total_price: request.order_total_including_shipping || 0,
      metadata: {
        customer_match: planItem.customer_match,
        normalized_address: planItem.normalized_address,
        shipping_instructions: planItem.shipping_instructions || {
          raw_note: request.note || "",
          requires_manual_pickup_shift: false,
          requested_pickup_shift_note: "",
        },
        processor_notes: planItem.notes || [],
        processor_blockers: planItem.blockers || [],
      },
    },
    warnings: [
      "Dashboard does not collect per-line pricing yet, so this draft preserves the expected total but does not resolve discounts or shipping allocation.",
      "Leave pickup shift unselected by default. Only choose one when the admin note explicitly requests it.",
      "Real Sapo create-order implementation should verify whether API creation supports the intended phone-order flow or needs Chrome fallback.",
    ],
  };
}

async function main() {
  const planPayload = await readJsonOrDefault(processingPlanPath, { items: [] });
  const items = Array.isArray(planPayload.items) ? planPayload.items : [];
  const readyItems = items.filter((item) => item.status === "ready");

  const payload = {
    schema: "tq-sapo-order-dry-run/v1",
    exported_at: new Date().toISOString(),
    request_count: readyItems.length,
    orders: readyItems.map(buildDraftOrder),
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Built ${readyItems.length} Sapo order dry-run payloads to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
