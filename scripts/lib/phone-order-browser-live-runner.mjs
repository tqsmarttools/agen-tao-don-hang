import { createChromePhoneOrderLiveAdapter } from "./chrome-phone-order-live-adapter.mjs";
import { runBrowserExecutor } from "../execute-phone-order-browser.mjs";

export async function runPhoneOrderBrowserLive({
  tab,
  baseUrl,
  requestId = "",
  maxSteps = 0,
}) {
  if (!tab) {
    throw new Error("runPhoneOrderBrowserLive requires a claimed browser tab.");
  }

  const adapter = createChromePhoneOrderLiveAdapter({ tab, baseUrl });
  globalThis.phoneOrderBrowserAdapter = adapter;

  try {
    return await runBrowserExecutor({
      requestId,
      dryRun: false,
      live: true,
      completeStep: 0,
      failStep: 0,
      maxSteps,
      note: "",
      reset: false,
    });
  } finally {
    delete globalThis.phoneOrderBrowserAdapter;
  }
}
