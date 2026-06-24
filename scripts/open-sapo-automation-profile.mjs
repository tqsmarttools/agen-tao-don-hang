import { loadPlaywright } from "./lib/load-playwright.mjs";
import {
  ensureAutomationProfileDir,
  sapoCreateOrderUrl,
} from "./lib/sapo-automation-profile.mjs";

async function main() {
  await ensureAutomationProfileDir();
  const playwright = await loadPlaywright();
  const context = await playwright.chromium.launchPersistentContext(
    (await import("./lib/sapo-automation-profile.mjs")).automationProfileDir,
    {
      headless: false,
    },
  );

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(sapoCreateOrderUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  console.log("Opened the dedicated Sapo automation browser profile.");
  console.log("Leave this window open and sign into Sapo once if needed.");

  await context.browser().waitForEvent("disconnected");
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
