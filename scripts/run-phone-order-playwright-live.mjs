import { loadPlaywright } from "./lib/load-playwright.mjs";
import { runPhoneOrderBrowserLive } from "./lib/phone-order-browser-live-runner.mjs";
import {
  automationProfileDir,
  ensureAutomationProfileDir,
  sapoCreateOrderUrl,
} from "./lib/sapo-automation-profile.mjs";

function parseArgs(argv) {
  const args = {
    requestId: "",
    maxSteps: 0,
    headless: false,
    reset: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--request-id") {
      args.requestId = argv[++index] || "";
    } else if (arg === "--max-steps") {
      args.maxSteps = Math.max(0, Number(argv[++index] || 0));
    } else if (arg === "--headless") {
      args.headless = true;
    } else if (arg === "--reset") {
      args.reset = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function wrapPlaywrightPage(page) {
  const shim = {
    waitForLoadState: async (options = {}) => {
      const state =
        typeof options === "string"
          ? options
          : options?.state || "load";
      const timeout =
        typeof options === "object" && options
          ? options.timeoutMs ?? options.timeout
          : undefined;
      await page.waitForLoadState(state, timeout ? { timeout } : undefined);
    },
    waitForTimeout: (timeoutMs) => page.waitForTimeout(timeoutMs),
    locator: (...args) => page.locator(...args),
    getByRole: (...args) => page.getByRole(...args),
    getByText: (...args) => page.getByText(...args),
    getByPlaceholder: (...args) => page.getByPlaceholder(...args),
    getByLabel: (...args) => page.getByLabel(...args),
    domSnapshot: async () => {
      const text = await page.locator("body").innerText().catch(() => "");
      return String(text || "");
    },
  };

  return {
    playwright: shim,
    goto: (url) => page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }),
    title: () => page.title(),
    url: () => page.url(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureAutomationProfileDir();
  const playwright = await loadPlaywright();
  let context;

  try {
    context = await playwright.chromium.launchPersistentContext(automationProfileDir, {
      headless: args.headless,
    });

    const page = context.pages()[0] || (await context.newPage());
    await page.goto(sapoCreateOrderUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2500);

    const url = page.url();
    if (/accounts\.sapo\.vn\/login/i.test(url)) {
      throw new Error(
        "The dedicated automation profile is not logged into Sapo yet. Run open-sapo-automation-profile.mjs, sign in once, then retry.",
      );
    }

    const result = await runPhoneOrderBrowserLive({
      tab: wrapPlaywrightPage(page),
      baseUrl: "https://thien-quang-smart-tools.mysapogo.com",
      requestId: args.requestId,
      maxSteps: args.maxSteps,
      reset: args.reset,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          request_id: result.executionPlan.request_id,
          completed_steps: result.payload.progress.completed_steps,
          total_steps: result.payload.progress.total_steps,
          next_actionable_step: result.payload.progress.next_actionable_step,
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
