import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ghnPost, ghnShopId, readGhnToken } from "./lib/ghn-client.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..");
const outputDir = path.join(workspaceRoot, "data");
const outputPath = path.join(outputDir, "customer-index.json");
const addressCatalogPath = path.join(outputDir, "address-catalog.json");

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function unixSeconds(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateText}`);
  }
  return Math.floor(date.getTime() / 1000);
}

function tomorrowDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function searchAllOrders(token, dateFrom, dateTo) {
  const fromTime = unixSeconds(`${dateFrom}T00:00:00+07:00`);
  const toTime = unixSeconds(`${dateTo}T00:00:00+07:00`);
  const orders = [];
  let offset = 0;
  let total = 1;

  while (offset < total) {
    const page = await ghnPost(
      "/v2/shipping-order/search",
      {
        shop_id: ghnShopId(),
        from_time: fromTime,
        to_time: toTime,
        offset,
        limit: 100,
      },
      token,
      true,
    );

    total = page.total;
    orders.push(...page.data);
    offset += 100;
  }

  return orders;
}

async function readAddressCatalog() {
  if (!existsSync(addressCatalogPath)) {
    return {
      districtById: new Map(),
      wardByDistrictWard: new Map(),
      provinceById: new Map(),
    };
  }

  const payload = JSON.parse(await readFile(addressCatalogPath, "utf8"));
  const districtById = new Map();
  const wardByDistrictWard = new Map();
  const provinceById = new Map();

  for (const province of payload.provinces || []) {
    provinceById.set(Number(province.province_id), province);
  }

  for (const district of payload.districts || []) {
    districtById.set(Number(district.district_id), district);
  }

  for (const [districtId, wards] of Object.entries(payload.wards_by_district_id || {})) {
    for (const ward of wards) {
      wardByDistrictWard.set(`${districtId}:${ward.ward_code}`, ward);
    }
  }

  return { districtById, wardByDistrictWard, provinceById };
}

function pushUniqueAddress(addresses, nextAddress) {
  const key = [
    nextAddress.address_detail,
    nextAddress.ward,
    nextAddress.district,
    nextAddress.province,
  ].join("|");

  if (!addresses.some((address) =>
    [address.address_detail, address.ward, address.district, address.province].join("|") === key
  )) {
    addresses.push(nextAddress);
  }
}

async function main() {
  const token = readGhnToken();
  const orders = await searchAllOrders(token, "2025-01-01", tomorrowDate());
  const { districtById, wardByDistrictWard, provinceById } = await readAddressCatalog();
  const customerMap = new Map();

  for (const order of orders) {
    const phone = normalizePhone(order.to_phone);
    if (!phone) {
      continue;
    }

    const district = districtById.get(Number(order.to_district_id));
    const ward = wardByDistrictWard.get(`${order.to_district_id}:${order.to_ward_code}`);
    const province = district ? provinceById.get(Number(district.province_id)) : null;

    const existing = customerMap.get(phone) || {
      phone,
      customer_name: order.to_name || "",
      order_count: 0,
      last_order_at: "",
      addresses: [],
    };

    existing.order_count += 1;

    if (!existing.customer_name && order.to_name) {
      existing.customer_name = order.to_name;
    }

    if (!existing.last_order_at || new Date(order.created_date) > new Date(existing.last_order_at)) {
      existing.last_order_at = order.created_date;
    }

    pushUniqueAddress(existing.addresses, {
      address_detail: order.to_address || "",
      ward: ward?.name || "",
      district: district?.name || "",
      province: province?.name || "",
      ward_code: order.to_ward_code || "",
      district_id: Number(order.to_district_id) || 0,
    });

    customerMap.set(phone, existing);
  }

  const customers = [...customerMap.values()].sort((left, right) => right.order_count - left.order_count);
  const payload = {
    schema: "tq-customer-index/v1",
    exported_at: new Date().toISOString(),
    source: {
      type: "ghn-orders",
      date_from: "2025-01-01",
    },
    customer_count: customers.length,
    customers,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Exported ${customers.length} customer records to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
