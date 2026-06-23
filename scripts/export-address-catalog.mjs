import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ghnGet, ghnPost, readGhnToken } from "./lib/ghn-client.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..");
const outputDir = path.join(workspaceRoot, "data");
const outputPath = path.join(outputDir, "address-catalog.json");

function normalizeProvince(province) {
  return {
    province_id: province.ProvinceID,
    code: province.Code,
    name: province.ProvinceName,
    search_terms: province.NameExtension || [],
  };
}

function normalizeDistrict(district) {
  return {
    district_id: district.DistrictID,
    province_id: district.ProvinceID,
    code: district.Code,
    name: district.DistrictName,
    search_terms: district.NameExtension || [],
  };
}

function normalizeWard(ward) {
  return {
    ward_code: ward.WardCode,
    district_id: ward.DistrictID,
    name: ward.WardName,
    search_terms: ward.NameExtension || [],
  };
}

async function main() {
  const token = readGhnToken();
  const provinces = (await ghnGet("/master-data/province", token)).map(normalizeProvince);
  const districts = (await ghnGet("/master-data/district", token)).map(normalizeDistrict);

  const wardsByDistrictId = {};

  for (const district of districts) {
    const wards = await ghnPost(
      `/master-data/ward?district_id=${district.district_id}`,
      { district_id: district.district_id },
      token,
    );
    wardsByDistrictId[String(district.district_id)] = Array.isArray(wards) ? wards.map(normalizeWard) : [];
  }

  const payload = {
    schema: "tq-address-catalog/v1",
    exported_at: new Date().toISOString(),
    source: {
      type: "ghn",
    },
    province_count: provinces.length,
    district_count: districts.length,
    provinces,
    districts,
    wards_by_district_id: wardsByDistrictId,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    `Exported ${provinces.length} provinces, ${districts.length} districts to ${outputPath}`,
  );
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
