import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..");
const siteDir = path.join(workspaceRoot, "site");
const dashboardSourceDir = path.join(workspaceRoot, "apps", "dashboard");
const dashboardTargetDir = path.join(siteDir, "apps", "dashboard");
const dataSourceDir = path.join(workspaceRoot, "data");
const dataTargetDir = path.join(siteDir, "data");
const phoneOrderConfigPath = path.join(dataSourceDir, "phone-order-config.json");
const customerIndexPath = path.join(dataSourceDir, "customer-index.json");
const defaultPublicInboxConfig = {
  inbox_url:
    "https://script.google.com/macros/s/AKfycbzy_wRA43K727aqBSdMALJScGHEjjlreExTBN-s5AJbxsUzPFvGca3X8XrMthQMVHU0/exec",
  inbox_key: "tqsmarttools-phone-order-inbox-20260625",
};

async function readJsonOrDefault(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
}

async function copyDashboardFiles() {
  await cp(dashboardSourceDir, dashboardTargetDir, { recursive: true });
}

async function writePublicData() {
  const productCatalog = await readJsonOrDefault(path.join(dataSourceDir, "product-catalog.json"), {
    items: [],
    product_count: 0,
    variant_count: 0,
  });
  const addressCatalog = await readJsonOrDefault(path.join(dataSourceDir, "address-catalog.json"), {
    provinces: [],
    districts: [],
    wards_by_district_id: {},
  });
  const customerIndex = await readJsonOrDefault(customerIndexPath, {
    customers: [],
    customer_count: 0,
  });

  const publicProductCatalog = {
    schema: "tq-product-catalog/v1",
    exported_at: new Date().toISOString(),
    product_count: productCatalog.product_count || 0,
    variant_count: productCatalog.variant_count || 0,
    items: (productCatalog.items || []).map((item) => ({
      variant_id: item.variant_id,
      product_id: item.product_id,
      sku: item.sku,
      barcode: item.barcode,
      product_name: item.product_name,
      variant_name: item.variant_name,
      display_name: item.display_name,
      keywords: item.keywords || [],
      active: item.active,
    })),
  };

  const publicAddressCatalog = {
    schema: "tq-address-catalog/v1",
    exported_at: new Date().toISOString(),
    province_count: addressCatalog.province_count || (addressCatalog.provinces || []).length,
    district_count: addressCatalog.district_count || (addressCatalog.districts || []).length,
    provinces: (addressCatalog.provinces || []).map((province) => ({
      province_id: province.province_id,
      code: province.code,
      name: province.name,
    })),
    districts: (addressCatalog.districts || []).map((district) => ({
      district_id: district.district_id,
      province_id: district.province_id,
      code: district.code,
      name: district.name,
    })),
    wards_by_district_id: Object.fromEntries(
      Object.entries(addressCatalog.wards_by_district_id || {}).map(([districtId, wards]) => [
        districtId,
        (wards || []).map((ward) => ({
          ward_code: ward.ward_code,
          district_id: ward.district_id,
          name: ward.name,
        })),
      ]),
    ),
  };

  const publicCustomerIndex = {
    schema: "tq-customer-index/v1",
    exported_at: new Date().toISOString(),
    customer_count: customerIndex.customer_count || (customerIndex.customers || []).length,
    customers: (customerIndex.customers || []).map((customer) => ({
      phone: customer.phone,
      customer_name: customer.customer_name,
      order_count: customer.order_count || 0,
      last_order_at: customer.last_order_at || "",
      addresses: Array.isArray(customer.addresses)
        ? customer.addresses.slice(0, 1).map((address) => ({
            address_detail: address.address_detail || "",
            ward: address.ward || "",
            district: address.district || "",
            province: address.province || "",
            ward_code: address.ward_code || "",
            district_id: address.district_id || null,
          }))
        : [],
    })),
  };

  const publicStatus = {
    schema: "tq-sapo-phone-order-status/v1",
    exported_at: "",
    request_count: 0,
    requests: [],
  };

  const privatePhoneOrderConfig = await readJsonOrDefault(phoneOrderConfigPath, null);
  const publicPhoneOrderConfig =
    privatePhoneOrderConfig &&
    privatePhoneOrderConfig.inbox_url &&
    privatePhoneOrderConfig.inbox_key
      ? {
          schema: "tq-phone-order-public-config/v1",
          exported_at: new Date().toISOString(),
          inbox_url: privatePhoneOrderConfig.inbox_url,
          inbox_key: privatePhoneOrderConfig.inbox_key,
        }
      : {
          schema: "tq-phone-order-public-config/v1",
          exported_at: new Date().toISOString(),
          inbox_url: defaultPublicInboxConfig.inbox_url,
          inbox_key: defaultPublicInboxConfig.inbox_key,
        };

  await mkdir(dataTargetDir, { recursive: true });
  await writeFile(path.join(dataTargetDir, "product-catalog.json"), `${JSON.stringify(publicProductCatalog, null, 2)}\n`, "utf8");
  await writeFile(path.join(dataTargetDir, "address-catalog.json"), `${JSON.stringify(publicAddressCatalog, null, 2)}\n`, "utf8");
  await writeFile(path.join(dataTargetDir, "customer-index.json"), `${JSON.stringify(publicCustomerIndex, null, 2)}\n`, "utf8");
  await writeFile(path.join(dataTargetDir, "ai-request-status.json"), `${JSON.stringify(publicStatus, null, 2)}\n`, "utf8");
  await writeFile(path.join(dataTargetDir, "phone-order-public-config.json"), `${JSON.stringify(publicPhoneOrderConfig, null, 2)}\n`, "utf8");
}

async function writeNoJekyll() {
  await writeFile(path.join(siteDir, ".nojekyll"), "", "utf8");
}

async function writeLandingPage() {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0; url=./apps/dashboard/index.html" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TQ Orders</title>
  </head>
  <body>
    <p>Redirecting to <a href="./apps/dashboard/index.html">the dashboard</a>...</p>
  </body>
</html>
`;
  await writeFile(path.join(siteDir, "index.html"), html, "utf8");
}

async function main() {
  await rm(siteDir, { recursive: true, force: true });
  await mkdir(siteDir, { recursive: true });
  await copyDashboardFiles();
  await writePublicData();
  await writeLandingPage();
  await writeNoJekyll();
  console.log(`Built public site at ${siteDir}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
