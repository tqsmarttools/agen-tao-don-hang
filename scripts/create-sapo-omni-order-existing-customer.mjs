import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./lib/load-playwright.mjs";
import {
  automationProfileDir,
  ensureAutomationProfileDir,
  sapoCreateOrderUrl,
} from "./lib/sapo-automation-profile.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..");

const shopDefaults = {
  locationId: 680305,
  assigneeId: 985325,
  priceListId: 2058901,
  sourceId: 7554444,
  sourceName: "Khác",
  shippingAccountId: "708589_3",
  inventoryId: 5896298,
  pickupCity: "TP Hồ Chí Minh",
  pickupDistrict: "Quận Thủ Đức",
  pickupWard: "Phường Hiệp Bình Chánh",
  pickupAddress: "12/14/20 đường 49",
  warehouseAddressForCarrier: "THIÊN QUANG",
  ghnRequiredNote: "CHOXEMHANGKHONGTHU",
  defaultPackage: {
    length: 10,
    width: 10,
    height: 10,
  },
};

function parseArgs(argv) {
  const args = {
    phone: "",
    sku: "",
    quantity: 1,
    cod: 0,
    submit: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--phone") {
      args.phone = argv[++index] || "";
    } else if (arg === "--sku") {
      args.sku = argv[++index] || "";
    } else if (arg === "--quantity") {
      args.quantity = Math.max(1, Number(argv[++index] || 1));
    } else if (arg === "--cod") {
      args.cod = Math.max(0, Number(argv[++index] || 0));
    } else if (arg === "--submit") {
      args.submit = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.phone || !args.sku) {
    throw new Error(
      "Usage: node scripts/create-sapo-omni-order-existing-customer.mjs --phone <phone> --sku <sku> [--quantity N] [--cod amount] [--submit]",
    );
  }

  return args;
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
  const result = await page.evaluate(
    async ({ relativeUrl: url, options: nextOptions }) => {
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(nextOptions.headers || {}),
        },
        method: nextOptions.method || "GET",
        body:
          nextOptions.body === undefined
            ? undefined
            : JSON.stringify(nextOptions.body),
      });

      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        text,
      };
    },
    { relativeUrl, options },
  );

  let payload = null;
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

function chooseCustomerAddress(customer) {
  const addresses = Array.isArray(customer.addresses) ? customer.addresses : [];
  return addresses[0] || null;
}

function chooseRetailPrice(variant, priceListId) {
  const prices = Array.isArray(variant.variant_prices) ? variant.variant_prices : [];
  return prices.find((price) => price.price_list_id === priceListId)?.value ?? variant.variant_retail_price ?? 0;
}

function buildShipmentDetail({
  customer,
  address,
  variant,
  quantity,
  codAmount,
  serviceName,
  serviceId,
  estimatedFee,
}) {
  return {
    partial_return: false,
    bundle_packages: false,
    shop_id: shopDefaults.inventoryId,
    warehouse_phone: "0931470376",
    warehouse_address: `${shopDefaults.pickupAddress}, ${shopDefaults.pickupWard}, ${shopDefaults.pickupDistrict}, ${shopDefaults.pickupCity}, Vietnam`,
    width: shopDefaults.defaultPackage.width,
    length: shopDefaults.defaultPackage.length,
    height: shopDefaults.defaultPackage.height,
    insurance_value: 0,
    weight: Number(variant.weight_value || 0) * quantity,
    pick_station_id: 0,
    coupon: "",
    service_id: serviceId,
    service_type_id: 2,
    service_name: serviceName,
    payment_type_id: 1,
    note: "",
    required_note: shopDefaults.ghnRequiredNote,
    content: `${variant.name},`,
    cod_failed_amount: 0,
    return_phone: null,
    return_district_id: 0,
    return_ward_code: null,
    return_address: shopDefaults.warehouseAddressForCarrier,
    receiver_name: customer.name,
    receiver_phone: customer.phone_number,
    receiver_address: address.address1,
    receiver_ward: address.ward,
    receiver_district_id: 10924,
    shipping_city: address.city,
    shipping_district: address.district,
    shipping_ward: address.ward,
    shipping_address: address.address1,
    shipping_phone: customer.phone_number,
    shipping_name: address.full_name || customer.name,
    items: [
      {
        name: variant.name,
        code: variant.sku,
        quantity,
      },
    ],
    _diagnostic_estimated_fee: estimatedFee,
  };
}

async function buildOrderPayload(page, args) {
  const customerPayload = await fetchJson(
    page,
    `/admin/customers/doSearch.json?query.contains=${encodeURIComponent(args.phone)}&page=1&limit=10&statuses.in=active&condition_type=must`,
  );
  const customer = (customerPayload.customers || [])[0];
  if (!customer) {
    throw new Error(`No active customer found for phone ${args.phone}. Existing-customer API path cannot continue.`);
  }

  const address = chooseCustomerAddress(customer);
  if (!address) {
    throw new Error(`Customer ${customer.name} has no active address on Sapo.`);
  }

  const variantPayload = await fetchJson(
    page,
    `/admin/variants/search.json?page=1&limit=10&sellable=true&location_id=${shopDefaults.locationId}&status=active&query=${encodeURIComponent(args.sku)}`,
  );
  const variant = (variantPayload.variants || [])[0];
  if (!variant) {
    throw new Error(`No sellable variant found for SKU ${args.sku}.`);
  }

  const codAmount = args.cod || chooseRetailPrice(variant, shopDefaults.priceListId) * args.quantity;

  const estimatePayload = await fetchJson(page, "/admin/shipping_services/ghn/estimate_fee.json", {
    method: "POST",
    body: {
      estimate_fee_request: {
        location_id: shopDefaults.locationId,
        pickup_city: shopDefaults.pickupCity,
        pickup_district: shopDefaults.pickupDistrict,
        pickup_ward: shopDefaults.pickupWard,
        pickup_address: shopDefaults.pickupAddress,
        shipping_city: address.city,
        shipping_district: address.district,
        shipping_ward: address.ward,
        shipping_address: address.address1,
        weight: Number(variant.weight_value || 0) * args.quantity,
        length: shopDefaults.defaultPackage.length,
        width: shopDefaults.defaultPackage.width,
        height: shopDefaults.defaultPackage.height,
        cod: codAmount,
        shipping_account_id: shopDefaults.shippingAccountId,
        inventory_id: shopDefaults.inventoryId,
        total_item: args.quantity,
        insurance: 0,
        discount_code: "",
      },
    },
  });

  const service = (estimatePayload.estimate_fees || [])[0];
  if (!service) {
    throw new Error("GHN estimate did not return any service.");
  }

  const payload = {
    order: {
      status: "finalized",
      customer_id: customer.id,
      billing_address: {
        country: address.country || "Vietnam",
        city: address.city,
        district: address.district,
        ward: address.ward,
        address1: address.address1,
        address2: address.address1,
        phone_number: customer.phone_number,
        label: address.label || address.address1,
        zip_code: address.zip_code || null,
        full_name: address.full_name || "",
        last_name: address.last_name || "",
        first_name: address.first_name || "",
        email: address.email || customer.email || "",
      },
      shipping_address: address,
      email: customer.email || "",
      phone_number: customer.phone_number,
      assignee_id: shopDefaults.assigneeId,
      price_list_id: shopDefaults.priceListId,
      location_id: shopDefaults.locationId,
      note: "",
      tags: [],
      source_id: shopDefaults.sourceId,
      source_name: shopDefaults.sourceName,
      reference_url: "",
      reference_number: "",
      expected_payment_method_id: null,
      code: "",
      create_invoice: false,
      order_line_items: [
        {
          product_id: variant.product_id,
          variant_id: variant.id,
          is_freeform: false,
          price: chooseRetailPrice(variant, shopDefaults.priceListId),
          tax_included: Boolean(variant.tax_included),
          tax_rate_override: variant.output_vat_rate || 0,
          note: "",
          quantity: args.quantity,
          discount_items: [],
        },
      ],
      discount_items: [],
      expected_delivery_type: "courier",
      fulfillments: [
        {
          assignee_id: shopDefaults.assigneeId,
          billing_address: {
            country: address.country || "Vietnam",
            city: address.city,
            district: address.district,
            ward: address.ward,
            address1: address.address1,
            address2: address.address1,
            phone_number: customer.phone_number,
            label: address.label || address.address1,
            zip_code: address.zip_code || null,
            full_name: address.full_name || "",
            last_name: address.last_name || "",
            first_name: address.first_name || "",
            email: address.email || customer.email || "",
          },
          delivery_type: "courier",
          notes: "",
          shipment: {
            delivery_fee: 0,
            cod_amount: codAmount,
            weight: Number(variant.weight_value || 0) * args.quantity,
            width: shopDefaults.defaultPackage.width,
            height: shopDefaults.defaultPackage.height,
            length: shopDefaults.defaultPackage.length,
            operation_system: "web",
            delivery_service_provider_id: 400688,
            note: "",
            service_name: service.service_name,
            freight_amount: service.final_fee,
            detail: JSON.stringify(
              buildShipmentDetail({
                customer,
                address,
                variant,
                quantity: args.quantity,
                codAmount,
                serviceName: service.service_name,
                serviceId: service.service_code,
                estimatedFee: service.final_fee,
              }),
            ),
            freight_payer: "shop",
            shipping_account_id: shopDefaults.shippingAccountId,
          },
        },
      ],
      coupon_code: null,
      promotion_redemptions: [],
      operation_system: "web",
    },
  };

  return {
    customer,
    address,
    variant,
    service,
    payload,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const result = await withSessionPage(async (page) => {
    const built = await buildOrderPayload(page, args);
    if (!args.submit) {
      return {
        ...built,
        response: null,
      };
    }

    const response = await fetchJson(page, "/admin/orders.json", {
      method: "POST",
      body: built.payload,
    });

    return {
      ...built,
      response,
    };
  });

  const outputPath = path.join(
    workspaceRoot,
    "data",
    args.submit ? "sapo-omni-order-api-submit.json" : "sapo-omni-order-api-preview.json",
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(`${outputPath}`, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        submit: args.submit,
        outputPath,
        customer_id: result.customer.id,
        customer_name: result.customer.name,
        variant_id: result.variant.id,
        variant_sku: result.variant.sku,
        estimated_service: result.service.service_name,
        estimated_fee: result.service.final_fee,
        created_order_id: result.response?.order?.id || null,
        created_order_code: result.response?.order?.code || null,
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
