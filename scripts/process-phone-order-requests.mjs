import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..");
const dataDir = path.join(workspaceRoot, "data");
const queuePath = path.join(dataDir, "ai-requests.json");
const productCatalogPath = path.join(dataDir, "product-catalog.json");
const customerIndexPath = path.join(dataDir, "customer-index.json");
const addressCatalogPath = path.join(dataDir, "address-catalog.json");
const planPath = path.join(dataDir, "phone-order-processing-plan.json");
const statusPath = path.join(dataDir, "ai-request-status.json");

async function readJsonOrDefault(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeAscii(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function parseShippingInstructions(note) {
  const rawNote = normalizeText(note);
  const normalizedNote = normalizeAscii(rawNote);
  const mentionsPickupShift =
    normalizedNote.includes("ca lay hang") ||
    normalizedNote.includes("ca lay") ||
    normalizedNote.includes("lay hang");

  return {
    raw_note: rawNote,
    requires_manual_pickup_shift: mentionsPickupShift,
    requested_pickup_shift_note: mentionsPickupShift ? rawNote : "",
  };
}

function findCustomerByPhone(customers, phone) {
  const normalized = normalizePhone(phone);
  return customers.find((customer) => normalizePhone(customer.phone) === normalized) || null;
}

function buildAddressIndexes(payload) {
  const provincesByName = new Map();
  const districtsByProvinceName = new Map();
  const wardsByDistrictName = new Map();

  for (const province of payload.provinces || []) {
    provincesByName.set(normalizeText(province.name).toLowerCase(), province);
  }

  for (const district of payload.districts || []) {
    const province = (payload.provinces || []).find(
      (candidate) => Number(candidate.province_id) === Number(district.province_id),
    );
    if (!province) {
      continue;
    }

    const provinceName = normalizeText(province.name).toLowerCase();
    const bucket = districtsByProvinceName.get(provinceName) || [];
    bucket.push(district);
    districtsByProvinceName.set(provinceName, bucket);
  }

  for (const [districtId, wards] of Object.entries(payload.wards_by_district_id || {})) {
    const district = (payload.districts || []).find(
      (candidate) => String(candidate.district_id) === String(districtId),
    );
    if (!district) {
      continue;
    }

    const districtName = normalizeText(district.name).toLowerCase();
    wardsByDistrictName.set(districtName, wards || []);
  }

  return {
    provincesByName,
    districtsByProvinceName,
    wardsByDistrictName,
  };
}

function validateRequest(request, productsByVariantId, customers, addressIndexes) {
  const blockers = [];
  const notes = [];
  const productMatches = [];

  const phone = normalizePhone(request.customer?.phone);
  const customerName = normalizeText(request.customer?.name);
  const address = request.address || {};
  const addressDetail = normalizeText(address.address_detail);
  const provinceName = normalizeText(address.province);
  const districtName = normalizeText(address.district);
  const wardName = normalizeText(address.ward);
  const total = Number(request.order_total_including_shipping || 0);
  const items = Array.isArray(request.items) ? request.items : [];
  const shippingInstructions = parseShippingInstructions(request.note);

  if (!phone) blockers.push("missing_customer_phone");
  if (!customerName) blockers.push("missing_customer_name");
  if (!provinceName) blockers.push("missing_province");
  if (!districtName) blockers.push("missing_district");
  if (!wardName) blockers.push("missing_ward");
  if (!addressDetail) blockers.push("missing_address_detail");
  if (!Number.isFinite(total) || total <= 0) blockers.push("invalid_order_total");
  if (items.length === 0) blockers.push("missing_items");

  const matchedCustomer = phone ? findCustomerByPhone(customers, phone) : null;
  if (matchedCustomer) {
    notes.push(`Matched existing customer with ${matchedCustomer.order_count} previous orders.`);
  } else if (phone) {
    notes.push("No existing customer match found by exact phone.");
  }

  if (shippingInstructions.requires_manual_pickup_shift) {
    notes.push("Admin note explicitly requests a pickup-shift instruction for the shipping step.");
  } else {
    notes.push("Leave pickup shift unselected unless the admin note explicitly requests one.");
  }

  const province = addressIndexes.provincesByName.get(provinceName.toLowerCase()) || null;
  if (!province && provinceName) {
    blockers.push("unknown_province");
  }

  const districtCandidates = provinceName
    ? (addressIndexes.districtsByProvinceName.get(provinceName.toLowerCase()) || [])
    : [];
  const district = districtCandidates.find(
    (candidate) => normalizeText(candidate.name).toLowerCase() === districtName.toLowerCase(),
  ) || null;
  if (!district && districtName) {
    blockers.push("unknown_district");
  }

  const wardCandidates = districtName
    ? (addressIndexes.wardsByDistrictName.get(districtName.toLowerCase()) || [])
    : [];
  const ward = wardCandidates.find(
    (candidate) => normalizeText(candidate.name).toLowerCase() === wardName.toLowerCase(),
  ) || null;
  if (!ward && wardName) {
    blockers.push("unknown_ward");
  }

  for (const item of items) {
    const quantity = Number(item.quantity || 0);
    const variantId = Number(item.variant_id || 0);
    const matchedProduct = productsByVariantId.get(variantId) || null;

    if (!matchedProduct) {
      blockers.push(`unknown_variant:${variantId || "missing"}`);
      continue;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      blockers.push(`invalid_quantity:${variantId}`);
      continue;
    }

    productMatches.push({
      variant_id: variantId,
      sku: matchedProduct.sku,
      requested_name: item.name || "",
      matched_name: matchedProduct.display_name,
      quantity,
    });
  }

  const isAlreadyCreated =
    normalizeText(request.status) === "created" ||
    normalizeText(request.execution_result?.status) === "created";
  const status = isAlreadyCreated ? "created" : blockers.length === 0 ? "ready" : "need_more_info";

  return {
    request_id: request.request_id,
    status,
    blockers,
    notes,
    customer_match: matchedCustomer
      ? {
          phone: matchedCustomer.phone,
          customer_name: matchedCustomer.customer_name,
          order_count: matchedCustomer.order_count,
          last_order_at: matchedCustomer.last_order_at,
        }
      : null,
    normalized_address: {
      province: province?.name || provinceName,
      district: district?.name || districtName,
      ward: ward?.name || wardName,
      address_detail: addressDetail,
      province_id: province?.province_id || null,
      district_id: district?.district_id || null,
      ward_code: ward?.ward_code || null,
    },
    product_matches: productMatches,
    shipping_instructions: shippingInstructions,
    request_snapshot: request,
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const queuePayload = await readJsonOrDefault(queuePath, { requests: [] });
  const productCatalogPayload = await readJsonOrDefault(productCatalogPath, { items: [] });
  const customerIndexPayload = await readJsonOrDefault(customerIndexPath, { customers: [] });
  const addressCatalogPayload = await readJsonOrDefault(addressCatalogPath, {});

  const requests = Array.isArray(queuePayload.requests) ? queuePayload.requests : [];
  const products = Array.isArray(productCatalogPayload.items) ? productCatalogPayload.items : [];
  const customers = Array.isArray(customerIndexPayload.customers) ? customerIndexPayload.customers : [];
  const productsByVariantId = new Map(
    products.map((product) => [Number(product.variant_id), product]),
  );
  const addressIndexes = buildAddressIndexes(addressCatalogPayload);

  const items = requests.map((request) =>
    validateRequest(request, productsByVariantId, customers, addressIndexes),
  );

  const planPayload = {
    schema: "tq-sapo-phone-order-processing-plan/v1",
    exported_at: new Date().toISOString(),
    request_count: items.length,
    items,
  };

  const statusPayload = {
    schema: "tq-sapo-phone-order-status/v1",
    exported_at: new Date().toISOString(),
    request_count: items.length,
    requests: items.map((item) => ({
      request_id: item.request_id,
      status: item.status,
      updated_at: item.updated_at,
      customer_name: item.request_snapshot.customer?.name || "",
      customer_phone: item.request_snapshot.customer?.phone || "",
      message:
        item.status === "created"
          ? `Created in Sapo Omni: ${item.request_snapshot.execution_result?.sapo_order_code || ""}`.trim()
          : item.status === "ready"
            ? "Ready for Sapo order creation."
            : `Need more info: ${item.blockers.join(", ")}`,
    })),
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(planPath, `${JSON.stringify(planPayload, null, 2)}\n`, "utf8");
  await writeFile(statusPath, `${JSON.stringify(statusPayload, null, 2)}\n`, "utf8");

  const readyCount = items.filter((item) => item.status === "ready").length;
  const createdCount = items.filter((item) => item.status === "created").length;
  const needMoreInfoCount = items.filter((item) => item.status === "need_more_info").length;
  console.log(
    `Processed ${items.length} requests. Created: ${createdCount}. Ready: ${readyCount}. Need more info: ${needMoreInfoCount}.`,
  );
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
