import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./lib/load-playwright.mjs";
import {
  automationProfileDir,
  ensureAutomationProfileDir,
  sapoCreateOrderUrl,
} from "./lib/sapo-automation-profile.mjs";
import {
  appendWorkerLog,
  findPlanItem,
  findQueueRequest,
  findStatusEntry,
  isTerminalExecutionStatus,
  loadPhoneOrderState,
  storePaths,
  updateQueueRequest,
  upsertStatusEntry,
  writeJson,
} from "./lib/phone-order-store.mjs";
import { syncRequestToSharedInbox } from "./lib/shared-inbox-sync.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..");
const dataDir = path.join(workspaceRoot, "data");
const workerCreatedStatus = "waiting_approval";
const shopDefaults = {
  locationId: 680305,
  assigneeId: 985325,
  priceListId: 2058901,
  sourceId: 7554444,
  sourceName: "Khác",
  customerGroupId: 2734496,
  deliveryServiceProviderId: 400688,
  shippingAccountId: "708589_3",
  inventoryId: 5896298,
  pickupCity: "TP Hồ Chí Minh",
  pickupDistrict: "Quận Thủ Đức",
  pickupWard: "Phường Hiệp Bình Chánh",
  pickupAddress: "12/14/20 đường 49",
  warehouseAddressForCarrier: "THIÊN QUANG",
  warehousePhone: "0931470376",
  ghnRequiredNote: "CHOXEMHANGKHONGTHU",
  defaultPackage: {
    length: 10,
    width: 10,
    height: 10,
  },
};

function parseArgs(argv) {
  const args = {
    requestId: "",
    submit: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--request-id") {
      args.requestId = argv[++index] || "";
    } else if (arg === "--submit") {
      args.submit = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.requestId) {
    throw new Error("Usage: node scripts/create-sapo-omni-order-from-request.mjs --request-id <id> [--submit]");
  }

  return args;
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D+/g, "");
  if (!digits) {
    return "";
  }
  if (digits.startsWith("84")) {
    return `0${digits.slice(2)}`;
  }
  if (digits.startsWith("0")) {
    return digits;
  }
  return `0${digits}`;
}

function toIntlPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return "";
  }
  return `+84${normalized.slice(1)}`;
}

async function readAddressCatalog() {
  return JSON.parse(await readFile(path.join(dataDir, "address-catalog.json"), "utf8"));
}

function canonicalAddressNames(addressCatalog, normalizedAddress) {
  const provinceId = normalizedAddress?.province_id;
  const districtId = normalizedAddress?.district_id;
  const wardCode = String(normalizedAddress?.ward_code || "");

  const province =
    (Array.isArray(addressCatalog.provinces)
      ? addressCatalog.provinces.find((item) => item.province_id === provinceId)
      : null) || null;
  const district =
    (Array.isArray(addressCatalog.districts)
      ? addressCatalog.districts.find((item) => item.district_id === districtId)
      : null) || null;
  const ward =
    (Array.isArray(addressCatalog.wards_by_district_id?.[String(districtId)])
      ? addressCatalog.wards_by_district_id[String(districtId)].find(
          (item) => String(item.ward_code) === wardCode,
        )
      : null) || null;

  const provinceDisplayName = (() => {
    if (!province) {
      return normalizedAddress?.province || "";
    }
    const searchTerms = Array.isArray(province.search_terms) ? province.search_terms : [];
    const preferred =
      searchTerms.find((term) => /^TP\s/i.test(term)) ||
      searchTerms.find((term) => /^TP\./i.test(term))?.replace(/^TP\.\s*/i, "TP ") ||
      province.name;
    return preferred;
  })();

  return {
    province: provinceDisplayName,
    district: district?.name || normalizedAddress?.district || "",
    ward: ward?.name || normalizedAddress?.ward || "",
  };
}

function buildCanonicalAddressBlock(planItem, addressCatalog) {
  const normalizedAddress = planItem.normalized_address || {};
  const names = canonicalAddressNames(addressCatalog, normalizedAddress);
  const detail = normalizedAddress.address_detail || "";
  return {
    address1: detail,
    address2: null,
    city: names.province,
    district: names.district,
    ward: names.ward,
    country: "Vietnam",
    label: detail || `${names.ward}, ${names.district}`,
    zip_code: null,
    status: "active",
  };
}

function normalizeCompare(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function normalizeAddressName(value) {
  return normalizeCompare(value)
    .replace(/[()\-_,./]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^tinh\s+/i, "")
    .replace(/^tp[.\s]+/i, "")
    .replace(/^thanh pho\s+/i, "")
    .trim();
}

function retailPriceForVariant(variant) {
  const prices = Array.isArray(variant.variant_prices) ? variant.variant_prices : [];
  const priceListMatch = prices.find((price) => price.price_list_id === shopDefaults.priceListId);
  return Number(priceListMatch?.value ?? variant.variant_retail_price ?? 0);
}

function distributeTotal(productMatches, variantsById, requestedTotal) {
  const lines = productMatches.map((match) => {
    const variant = variantsById.get(match.variant_id);
    const retailPrice = retailPriceForVariant(variant);
    return {
      ...match,
      retailPrice,
      baseValue: retailPrice * Number(match.quantity || 1),
    };
  });

  const baseTotal = lines.reduce((sum, line) => sum + line.baseValue, 0);
  if (baseTotal <= 0) {
    const evenUnit = Math.floor(requestedTotal / Math.max(1, lines.length));
    let remainder = requestedTotal - evenUnit * lines.length;
    return lines.map((line, index) => {
      const lineTotal = evenUnit + (index === lines.length - 1 ? remainder : 0);
      return {
        ...line,
        finalLineTotal: lineTotal,
        finalUnitPrice: Math.floor(lineTotal / Math.max(1, Number(line.quantity || 1))),
      };
    });
  }

  let assigned = 0;
  const distributed = lines.map((line, index) => {
    if (index === lines.length - 1) {
      const remaining = requestedTotal - assigned;
      return {
        ...line,
        finalLineTotal: remaining,
      };
    }

    const lineTotal = Math.round((requestedTotal * line.baseValue) / baseTotal);
    assigned += lineTotal;
    return {
      ...line,
      finalLineTotal: lineTotal,
    };
  });

  return distributed.map((line, index) => {
    const qty = Math.max(1, Number(line.quantity || 1));
    let finalUnitPrice = Math.floor(line.finalLineTotal / qty);
    if (index === distributed.length - 1) {
      const previousTotal = distributed
        .slice(0, -1)
        .reduce((sum, item) => sum + Math.floor(item.finalLineTotal / Math.max(1, Number(item.quantity || 1))) * Math.max(1, Number(item.quantity || 1)), 0);
      const remainder = requestedTotal - previousTotal;
      finalUnitPrice = Math.floor(remainder / qty);
    }

    return {
      ...line,
      finalUnitPrice,
    };
  });
}

async function withSessionPage(fn) {
  await ensureAutomationProfileDir();
  const playwright = await loadPlaywright();
  let context;
  try {
    context = await playwright.chromium.launchPersistentContext(automationProfileDir, {
      headless: true,
    });
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(sapoCreateOrderUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2500);
    return await fn(page);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

async function fetchJson(page, relativeUrl, options = {}) {
  const response = await page.request.fetch(new URL(relativeUrl, sapoCreateOrderUrl).href, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Sapo-LocationId": String(shopDefaults.locationId),
      ...(options.headers || {}),
    },
    data: options.body,
    failOnStatusCode: false,
  });

  const result = {
    ok: response.ok(),
    status: response.status(),
    text: await response.text(),
  };

  let payload;
  try {
    payload = result.text ? JSON.parse(result.text) : null;
  } catch {
    payload = result.text;
  }

  if (!result.ok) {
    throw new Error(
      `Session API ${options.method || "GET"} ${relativeUrl} failed: HTTP ${result.status} ${typeof payload === "string" ? payload : JSON.stringify(payload)}`,
    );
  }

  return payload;
}

async function searchCustomerByPhone(page, phone) {
  const payload = await fetchJson(
    page,
    `/admin/customers/doSearch.json?query.contains=${encodeURIComponent(phone)}&page=1&limit=10&statuses.in=active&condition_type=must`,
  );
  return (payload.customers || [])[0] || null;
}

async function createCustomerViaSession(page, planItem, addressBlock) {
  const request = planItem.request_snapshot || {};
  const customer = request.customer || {};
  const phone = normalizePhone(customer.phone || "");
  const payload = await fetchJson(page, "/admin/customers.json", {
    method: "POST",
    body: {
      customer: {
        name: customer.name || "",
        phone_number: phone,
        status: "active",
        customer_group_id: shopDefaults.customerGroupId,
        tags: [],
        addresses: [
          {
            ...addressBlock,
            phone_number: phone,
            email: null,
          },
        ],
      },
    },
  });

  return payload.customer;
}

function buildOrderAddress(customerRecord, addressBlock, requestPhone) {
  return {
    country: addressBlock.country,
    city: addressBlock.city,
    district: addressBlock.district,
    ward: addressBlock.ward,
    address1: addressBlock.address1,
    address2: addressBlock.address1,
    phone_number: normalizePhone(requestPhone),
    label: addressBlock.label,
    zip_code: null,
    address_level: "3level",
    full_name: "",
    last_name: "",
    first_name: "",
    email: customerRecord?.email || "",
  };
}

function buildShippingAddressRecord(customerRecord, addressBlock, requestPhone) {
  return {
    country: addressBlock.country,
    city: addressBlock.city,
    district: addressBlock.district,
    ward: addressBlock.ward,
    address1: addressBlock.address1,
    address2: null,
    zip_code: null,
    email: customerRecord?.email || null,
    first_name: null,
    last_name: null,
    full_name: customerRecord?.name || null,
    label: addressBlock.label,
    phone_number: normalizePhone(requestPhone),
    status: "active",
    address_level: "3level",
  };
}

async function fetchVariantsForMatches(page, productMatches) {
  const entries = [];
  for (const match of productMatches) {
    const payload = await fetchJson(
      page,
      `/admin/variants/search.json?page=1&limit=10&sellable=true&location_id=${shopDefaults.locationId}&status=active&query=${encodeURIComponent(match.sku)}`,
    );
    const variant = (payload.variants || [])[0];
    if (!variant) {
      throw new Error(`Could not find sellable variant for SKU ${match.sku}.`);
    }
    entries.push([match.variant_id, variant]);
  }

  return new Map(entries);
}

function buildOrderPayload({
  planItem,
  customerRecord,
  addressBlock,
  variantsById,
  allocatedLines,
}) {
  const request = planItem.request_snapshot || {};
  const customer = request.customer || {};
  const orderAddress = buildOrderAddress(customerRecord, addressBlock, customer.phone || "");
  const shippingAddress = buildShippingAddressRecord(customerRecord, addressBlock, customer.phone || "");

  return {
    order: {
      status: "draft",
      customer_id: customerRecord.id,
      billing_address: orderAddress,
      shipping_address: shippingAddress,
      email: customerRecord.email || "",
      phone_number: normalizePhone(customer.phone || ""),
      assignee_id: shopDefaults.assigneeId,
      price_list_id: shopDefaults.priceListId,
      location_id: shopDefaults.locationId,
      note: request.note || "",
      tags: [],
      source_id: shopDefaults.sourceId,
      source_name: shopDefaults.sourceName,
      reference_url: "",
      reference_number: "",
      expected_payment_method_id: null,
      code: "",
      create_invoice: false,
      order_line_items: allocatedLines.map((line) => {
        const variant = variantsById.get(line.variant_id);
        return {
          product_id: variant.product_id,
          variant_id: variant.id,
          is_freeform: false,
          price: Math.max(0, Number(line.finalUnitPrice || 0)),
          tax_included: Boolean(variant.tax_included),
          tax_rate_override: variant.output_vat_rate || 0,
          note: "",
          quantity: Number(line.quantity || 1),
          discount_items: [],
        };
      }),
      discount_items: [],
      coupon_code: null,
      promotion_redemptions: [],
      operation_system: "web",
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = await loadPhoneOrderState();
  const planItem = findPlanItem(state.planPayload, args.requestId);
  if (!planItem) {
    throw new Error(`Request not found in processing plan: ${args.requestId}`);
  }

  const queueRequest = findQueueRequest(state.queuePayload, args.requestId);
  if (isTerminalExecutionStatus(queueRequest?.execution_result?.status)) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: "already_terminal",
          request_id: args.requestId,
          status: queueRequest?.execution_result?.status || queueRequest?.status || "",
        },
        null,
        2,
      ),
    );
    return;
  }

  const addressCatalog = await readAddressCatalog();
  const addressBlock = buildCanonicalAddressBlock(planItem, addressCatalog);

  const result = await withSessionPage(async (page) => {
    const request = planItem.request_snapshot || {};
    const customerPhone = normalizePhone(request.customer?.phone || "");
    let customerRecord = await searchCustomerByPhone(page, customerPhone);
    let customerCreated = false;

    if (!customerRecord) {
      customerRecord = await createCustomerViaSession(page, planItem, addressBlock);
      customerCreated = true;
    }

    const variantsById = await fetchVariantsForMatches(page, planItem.product_matches);
    const allocatedLines = distributeTotal(
      planItem.product_matches,
      variantsById,
      Number(request.order_total_including_shipping || 0),
    );

    const payload = buildOrderPayload({
      planItem,
      customerRecord,
      addressBlock,
      variantsById,
      allocatedLines,
    });

    let response = null;
    if (args.submit) {
      response = await fetchJson(page, "/admin/orders.json", {
        method: "POST",
        body: payload,
      });
    }

    return {
      request_id: args.requestId,
      customerCreated,
      customerRecord,
      addressBlock,
      allocatedLines,
      payload,
      response,
    };
  });

  const outputPath = path.join(
    dataDir,
    args.submit
      ? `sapo-omni-order-${args.requestId}-submit.json`
      : `sapo-omni-order-${args.requestId}-preview.json`,
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  if (args.submit && result.response?.order?.id && result.response?.order?.code) {
    const queueRequest = findQueueRequest(state.queuePayload, args.requestId);
    const statusEntry = findStatusEntry(state.statusPayload, args.requestId);
    const now = new Date().toISOString();
    const orderUrl = `${new URL(`/admin/orders/${result.response.order.id}`, sapoCreateOrderUrl).href}`;

    if (queueRequest) {
      updateQueueRequest(state.queuePayload, args.requestId, {
        status: workerCreatedStatus,
        updated_at: now,
        execution_result: {
          status: workerCreatedStatus,
          recorded_at: now,
          sapo_order_code: result.response.order.code,
          sapo_order_url: orderUrl,
          shipment_code: "",
          carrier: "",
          partner_status: "Chờ lấy hàng",
          operator_note: "Created as a draft order waiting for admin approval.",
        },
      });
    }

    upsertStatusEntry(state.statusPayload, {
      request_id: args.requestId,
      status: workerCreatedStatus,
      updated_at: now,
      customer_name:
        result.customerRecord?.name ||
        queueRequest?.customer?.name ||
        statusEntry?.customer_name ||
        "",
      customer_phone:
        normalizePhone(result.customerRecord?.phone_number || "") ||
        queueRequest?.customer?.phone ||
        statusEntry?.customer_phone ||
        "",
      message: `Da tao don cho duyet tren Sapo: ${result.response.order.code}.`,
    });

    await appendWorkerLog({
      request_id: args.requestId,
      event_type: "omni_session_order_waiting_approval_created",
      sapo_order_id: result.response.order.id,
      sapo_order_code: result.response.order.code,
      sapo_order_url: orderUrl,
    });

    await writeJson(storePaths.queuePath, state.queuePayload);
    await writeJson(storePaths.statusPath, state.statusPayload);

    if (queueRequest) {
      await syncRequestToSharedInbox(queueRequest);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        submit: args.submit,
        outputPath,
        request_id: result.request_id,
        customer_created: result.customerCreated,
        customer_id: result.customerRecord?.id || null,
        customer_name: result.customerRecord?.name || null,
        created_order_status: result.response?.order?.status || null,
        estimated_service: null,
        estimated_fee: null,
        created_order_id: result.response?.order?.id || null,
        created_order_code: result.response?.order?.code || null,
        created_order_url: result.response?.order?.id
          ? `${new URL(`/admin/orders/${result.response.order.id}`, sapoCreateOrderUrl).href}`
          : null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
