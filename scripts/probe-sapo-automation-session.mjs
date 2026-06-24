import { loadPlaywright } from "./lib/load-playwright.mjs";
import {
  automationProfileDir,
  ensureAutomationProfileDir,
  sapoCreateOrderUrl,
} from "./lib/sapo-automation-profile.mjs";

async function main() {
  await ensureAutomationProfileDir();
  const playwright = await loadPlaywright();
  let context;

  try {
    context = await playwright.chromium.launchPersistentContext(automationProfileDir, {
      headless: false,
    });

    const page = context.pages()[0] || (await context.newPage());
    await page.goto(sapoCreateOrderUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2500);

    const title = await page.title();
    const url = page.url();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const loginRequired =
      /accounts\.sapo\.vn\/login/i.test(url) ||
      bodyText.includes("Dang nhap") ||
      bodyText.includes("Đăng nhập");

    console.log(
      JSON.stringify(
        {
          ok: true,
          profile_dir: automationProfileDir,
          title,
          url,
          login_required: loginRequired,
          body_snippet: String(bodyText).slice(0, 400),
        },
        null,
        2,
      ),
    );
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
