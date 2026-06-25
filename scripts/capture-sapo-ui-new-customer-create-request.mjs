import { mkdir, writeFile } from "node:fs/promises";
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
const outputPath = path.join(workspaceRoot, "data", "sapo-ui-new-customer-capture.json");

function clip(value, limit = 12000) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}...[truncated]` : text;
}

async function main() {
  await ensureAutomationProfileDir();
  const playwright = await loadPlaywright();
  let context;

  const now = new Date();
  const uniqueSuffix = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`;
  const testCustomer = {
    name: `Codex Capture ${uniqueSuffix}`,
    phone: `0900${uniqueSuffix.slice(-6)}`,
    areaSearch: "binh tan",
    areaChoice: "TP Hồ Chí Minh - Quận Bình Tân",
    wardChoice: "Phường Bình Trị Đông",
    address1: `capture ${uniqueSuffix}`,
  };

  const events = [];
  let captureArmed = false;
  let abortedRequest = null;

  try {
    context = await playwright.chromium.launchPersistentContext(automationProfileDir, {
      headless: false,
    });

    const page = context.pages()[0] || (await context.newPage());
    const origin = new URL(sapoCreateOrderUrl).origin;

    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      const method = request.method();

      if (
        captureArmed &&
        !abortedRequest &&
        url.startsWith(origin) &&
        ["POST", "PUT", "PATCH"].includes(method) &&
        ["xhr", "fetch"].includes(request.resourceType())
      ) {
        abortedRequest = {
          method,
          url,
          resourceType: request.resourceType(),
          headers: request.headers(),
          postData: clip(request.postData() || ""),
          at: new Date().toISOString(),
        };
        events.push({
          phase: "request_aborted_for_capture",
          ...abortedRequest,
        });
        await route.abort("failed");
        return;
      }

      await route.continue();
    });

    page.on("response", async (response) => {
      const request = response.request();
      const url = response.url();
      if (!url.startsWith(origin)) {
        return;
      }
      if (!["POST", "PUT", "PATCH", "GET"].includes(request.method())) {
        return;
      }
      if (!["xhr", "fetch"].includes(request.resourceType())) {
        return;
      }

      let body = "";
      try {
        body = clip(await response.text(), 4000);
      } catch {
        body = "";
      }

      events.push({
        phase: "response",
        method: request.method(),
        url,
        status: response.status(),
        resourceType: request.resourceType(),
        body,
        at: new Date().toISOString(),
      });
    });

    await page.goto(sapoCreateOrderUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(3000);

    const customerInput = page.locator("input#buttonF4").first();
    await customerInput.fill(testCustomer.phone);
    await page.waitForTimeout(2000);

    const createCustomerSuggestion = page.locator("button.InfiniteScroll-BoxCreate").first();
    if ((await createCustomerSuggestion.count().catch(() => 0)) < 1) {
      throw new Error("Could not find the create-customer suggestion button.");
    }
    await createCustomerSuggestion.click();
    await page.waitForTimeout(1500);

    const modalInputs = page.locator("input.sc-eBMEME");
    await modalInputs.nth(0).fill(testCustomer.name);
    await page.locator('input[placeholder="Nhập số nhà, tên đường, tên khu vực"]').first().fill(testCustomer.address1);

    // Khu vực
    await page.getByText("Chọn Tỉnh/Thành phố", { exact: false }).first().click();
    await page.waitForTimeout(400);
    const areaSearch = page.getByRole("textbox", { name: "Tìm kiếm khu vực" });
    await areaSearch.fill(testCustomer.areaSearch);
    await page.waitForTimeout(500);
    await page.getByText(testCustomer.areaChoice, { exact: false }).first().click();
    await page.waitForTimeout(500);

    // Phường xã
    await page.getByText("Chọn Phường/Xã", { exact: false }).first().click();
    await page.waitForTimeout(400);
    await page.getByText(testCustomer.wardChoice, { exact: false }).first().click();
    await page.waitForTimeout(500);

    const preClickInputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("input, textarea")).map((element, index) => ({
        index,
        placeholder: element.getAttribute("placeholder"),
        id: element.id || "",
        value: element.value || "",
      })),
    );

    const screenshotPath = path.join(workspaceRoot, "tmp-new-customer-pre-submit.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });

    captureArmed = true;
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const target = buttons.find((button) => (button.innerText || "").trim() === "Thêm");
      if (!target) {
        return false;
      }
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    });
    if (!clicked) {
      throw new Error("Could not find the modal add button.");
    }
    await page.waitForTimeout(2500);

    const bodyText = clip(await page.locator("body").innerText().catch(() => ""), 6000);

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          captured_at: new Date().toISOString(),
          testCustomer,
          preClickInputs,
          screenshotPath,
          abortedRequest,
          bodyText,
          events,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    console.log(`Saved new-customer capture to ${outputPath}`);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
