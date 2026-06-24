import assert from "node:assert/strict";
import { buildBrowserStepsFromPlanLike } from "./lib/phone-order-browser-steps.mjs";

function buildPlanLike({ customerMatch }) {
  return {
    customer_match: customerMatch,
    normalized_address: {
      province: "Ha Noi",
      district: "Chuong My",
      ward: "Dong Phu",
      address_detail: "Doi 2, Thon Ha Duc",
    },
    shipping_instructions: {
      requested_pickup_shift_note: "",
    },
    request_snapshot: {
      customer: {
        name: "Cao Van May_Minh Tin",
        phone: "0983087947",
      },
      order_total_including_shipping: 350000,
    },
    product_matches: [
      {
        sku: "X8-2X1T",
        quantity: 1,
      },
    ],
  };
}

function findStep(steps, action) {
  return steps.find((step) => step.action === action);
}

function main() {
  const existingCustomerSteps = buildBrowserStepsFromPlanLike(
    buildPlanLike({ customerMatch: { phone: "0983087947" } }),
  );
  const existingCustomerStep = findStep(existingCustomerSteps, "select_existing_customer_if_shown");
  assert.ok(existingCustomerStep, "existing-customer step should be present");
  assert.equal(existingCustomerStep.phone, "0983087947");
  assert.equal(existingCustomerStep.address.address_detail, "Doi 2, Thon Ha Duc");

  const newCustomerSteps = buildBrowserStepsFromPlanLike(
    buildPlanLike({ customerMatch: null }),
  );
  const createCustomerStep = findStep(newCustomerSteps, "create_customer_if_missing");
  assert.ok(createCustomerStep, "new-customer step should be present");
  assert.equal(createCustomerStep.customer_name, "Cao Van May_Minh Tin");
  assert.equal(createCustomerStep.phone, "0983087947");
  assert.equal(createCustomerStep.address.province, "Ha Noi");
  assert.equal(createCustomerStep.address.address_detail, "Doi 2, Thon Ha Duc");

  console.log("Browser-step builder smoke test passed.");
}

main();
