import { runPhoneOrderBrowserLive } from "./phone-order-browser-live-runner.mjs";

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

async function claimMatchingTab(browser, predicate) {
  const tabs = await browser.user.openTabs();
  const match = tabs.find(predicate);
  if (!match) {
    throw new Error("Could not find a matching Chrome tab.");
  }
  return browser.user.claimTab(match);
}

export async function claimSapoCreateOrderTab(browser, { baseUrl }) {
  const normalizedBase = normalizeUrl(baseUrl);
  return claimMatchingTab(browser, (tabInfo) =>
    String(tabInfo.url || "").startsWith(`${normalizedBase}/admin/orders/create`),
  );
}

export async function claimAnySapoTab(browser, { baseUrl }) {
  const normalizedBase = normalizeUrl(baseUrl);
  return claimMatchingTab(browser, (tabInfo) =>
    String(tabInfo.url || "").startsWith(`${normalizedBase}/admin/`),
  );
}

export async function runClaimedSapoExecution({
  browser,
  tab,
  baseUrl,
  requestId = "",
  maxSteps = 0,
}) {
  if (!browser) {
    throw new Error("runClaimedSapoExecution requires a browser instance.");
  }

  const claimedTab =
    tab ||
    (await claimSapoCreateOrderTab(browser, { baseUrl }).catch(async () =>
      claimAnySapoTab(browser, { baseUrl }),
    ));

  return runPhoneOrderBrowserLive({
    tab: claimedTab,
    baseUrl,
    requestId,
    maxSteps,
  });
}
