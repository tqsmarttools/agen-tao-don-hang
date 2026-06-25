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
const outputPath = path.join(workspaceRoot, "data", "sapo-ui-create-order-capture.json");

function clip(value, limit = 4000) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}...[truncated]` : text;
}

async function waitForMenuAndClick(page, matcherText = "") {
  await page.waitForTimeout(1800);

  const menuItems = page.locator('[role="menuitem"]');
  const menuCount = await menuItems.count().catch(() => 0);
  if (menuCount > 0) {
    if (matcherText) {
      const candidate = page.getByText(matcherText, { exact: false });
      const candidateCount = await candidate.count().catch(() => 0);
      if (candidateCount > 0) {
        await candidate.first().click();
        await page.waitForTimeout(1500);
        return `clicked text match: ${matcherText}`;
      }
    }

    await menuItems.first().click();
    await page.waitForTimeout(1500);
    return "clicked first menuitem";
  }

  return "no menuitem found";
}

async function main() {
  await ensureAutomationProfileDir();
  const playwright = await loadPlaywright();
  let context;

  const events = [];
  const startedAt = new Date().toISOString();

  try {
    context = await playwright.chromium.launchPersistentContext(automationProfileDir, {
      headless: false,
    });

    const page = context.pages()[0] || (await context.newPage());
    const origin = new URL(sapoCreateOrderUrl).origin;

    page.on("request", (request) => {
      const url = request.url();
      if (!url.startsWith(origin)) {
        return;
      }
      const method = request.method();
      if (!["POST", "PUT", "PATCH", "DELETE", "GET"].includes(method)) {
        return;
      }

      events.push({
        phase: "request",
        method,
        url,
        resourceType: request.resourceType(),
        postData: clip(request.postData() || ""),
        at: new Date().toISOString(),
      });
    });

    page.on("response", async (response) => {
      const url = response.url();
      if (!url.startsWith(origin)) {
        return;
      }
      const request = response.request();
      const method = request.method();
      if (!["POST", "PUT", "PATCH", "DELETE", "GET"].includes(method)) {
        return;
      }

      let body = "";
      try {
        body = clip(await response.text());
      } catch {
        body = "";
      }

      events.push({
        phase: "response",
        method,
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

    // Existing customer path to minimize UI friction while still exercising the real create flow.
    await page.locator("input#buttonF4").first().fill("0938988264");
    const customerSelection = await waitForMenuAndClick(page, "0938988264");

    await page.locator("input#buttonF3").first().fill("BCR-I-V25");
    const productSelection = await waitForMenuAndClick(page, "BCR-I-V25");

    // Give the page a moment to recalculate totals.
    await page.waitForTimeout(3500);

    const shippingChoice = page.getByText("Hàng nhẹ", { exact: false });
    if ((await shippingChoice.count().catch(() => 0)) > 0) {
      await shippingChoice.first().click();
      await page.waitForTimeout(1500);
    }

    // Capture button list just before submit to help future debugging.
    const buttonSnapshot = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .map((button) => ({
          text: (button.innerText || "").trim(),
          id: button.id || "",
          disabled: Boolean(button.disabled),
        }))
        .filter((item) => item.text),
    );

    await page.locator("#buttonF1").first().click();
    await page.waitForTimeout(1500);

    const confirmButton = page.getByRole("button", {
      name: "Xác nhận tạo đơn và giao hàng",
      exact: false,
    });
    if ((await confirmButton.count().catch(() => 0)) > 0) {
      await confirmButton.last().click();
      await page.waitForTimeout(5000);
    } else {
      await page.waitForTimeout(5000);
    }

    const afterSubmitUrl = page.url();
    const title = await page.title();
    const bodyText = clip(await page.locator("body").innerText().catch(() => ""), 6000);

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          customerSelection,
          productSelection,
          afterSubmitUrl,
          title,
          buttonSnapshot,
          bodyText,
          events,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    console.log(`Saved network capture to ${outputPath}`);
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
