import { runBrowserExecutor } from "./execute-phone-order-browser.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { storePaths } from "./lib/phone-order-store.mjs";

function createMockAdapter() {
  const calls = [];
  const record = (name) => async () => {
    calls.push(name);
    return {
      note: `Mock completed ${name}`,
      mock_step: name,
    };
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

async function loadExecutionPlanRequestId() {
  if (!existsSync(storePaths.executionPlanPath)) {
    return "sample-0983087947-001";
  }

  const payload = JSON.parse((await readFile(storePaths.executionPlanPath, "utf8")).replace(/^\uFEFF/, ""));
  return payload?.request_id || "sample-0983087947-001";
}

async function main() {
  const { adapter, calls } = createMockAdapter();
  globalThis.phoneOrderBrowserAdapter = adapter;
  const requestId = await loadExecutionPlanRequestId();
  const previousWorkerOutput = existsSync(storePaths.workerOutputPath)
    ? await readFile(storePaths.workerOutputPath, "utf8")
    : null;
  const previousExecutionNotes = existsSync(storePaths.executionNotesPath)
    ? await readFile(storePaths.executionNotesPath, "utf8")
    : null;

  try {
    const result = await runBrowserExecutor({
      requestId,
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
    assert.equal(result.payload.step_checklist[0].live_result?.mock_step, "openCreateOrderPage");
    assert.equal(result.payload.step_checklist[1].live_result?.mock_step, "searchCustomerByPhone");
    console.log("Live smoke test preserved structured live results.");
  } finally {
    if (previousWorkerOutput !== null) {
      await writeFile(storePaths.workerOutputPath, previousWorkerOutput, "utf8");
    }

    if (previousExecutionNotes !== null) {
      await writeFile(storePaths.executionNotesPath, previousExecutionNotes, "utf8");
    }

    delete globalThis.phoneOrderBrowserAdapter;
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
