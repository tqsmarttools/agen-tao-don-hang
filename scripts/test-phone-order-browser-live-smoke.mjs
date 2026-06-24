import { runBrowserExecutor } from "./execute-phone-order-browser.mjs";

function createMockAdapter() {
  const calls = [];
  const record = (name) => async () => {
    calls.push(name);
  };

  return {
    calls,
    adapter: {
      openCreateOrderPage: record("openCreateOrderPage"),
      searchCustomerByPhone: record("searchCustomerByPhone"),
      selectExistingCustomerIfShown: record("selectExistingCustomerIfShown"),
      createCustomerIfMissing: record("createCustomerIfMissing"),
      ensureShippingAddress: record("ensureShippingAddress"),
      addProductBySku: record("addProductBySku"),
      switchShippingMode: record("switchShippingMode"),
      setCustomerTotal: record("setCustomerTotal"),
      setCodAmount: record("setCodAmount"),
      setDeclaredPackageValue: record("setDeclaredPackageValue"),
      leavePickupShiftBlankUnlessRequested: record("leavePickupShiftBlankUnlessRequested"),
      submitOrder: record("submitOrder"),
    },
  };
}

async function main() {
  const { adapter, calls } = createMockAdapter();
  globalThis.phoneOrderBrowserAdapter = adapter;

  try {
    const result = await runBrowserExecutor({
      requestId: "sample-0983087947-001",
      dryRun: false,
      live: true,
      completeStep: 0,
      failStep: 0,
      maxSteps: 2,
      note: "",
      reset: true,
    });

    console.log(`Live smoke test calls: ${calls.join(", ")}`);
    console.log(
      `Completed steps after smoke run: ${result.payload.progress.completed_steps}/${result.payload.progress.total_steps}`,
    );
  } finally {
    delete globalThis.phoneOrderBrowserAdapter;
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
