function requestCustomer(planLike) {
  return planLike.request_snapshot?.customer || {};
}

function requestTotal(planLike) {
  return planLike.request_snapshot?.order_total_including_shipping || 0;
}

function requestItems(planLike) {
  return planLike.product_matches || [];
}

export function buildBrowserStepsFromPlanLike(planLike) {
  const customer = requestCustomer(planLike);
  const normalizedAddress = planLike.normalized_address || {};
  const productLines = requestItems(planLike).map((item) => ({
    action: "add_product_by_sku",
    sku: item.sku,
    quantity: item.quantity,
  }));

  return [
    {
      action: "open_create_order_page",
      target: "/admin/orders/create",
    },
    {
      action: "search_customer_by_phone",
      phone: customer.phone || "",
    },
    {
      action: planLike.customer_match ? "select_existing_customer_if_shown" : "create_customer_if_missing",
      customer_name: customer.name || "",
      phone: customer.phone || "",
      address: normalizedAddress,
    },
    {
      action: "ensure_shipping_address",
      address: normalizedAddress,
    },
    ...productLines,
    {
      action: "switch_shipping_mode",
      mode: "carrier",
      preferred_carrier: "GHN",
    },
    {
      action: "set_customer_total",
      amount: requestTotal(planLike),
    },
    {
      action: "set_cod_amount",
      amount: requestTotal(planLike),
    },
    {
      action: "set_declared_package_value",
      amount: requestTotal(planLike),
    },
    {
      action: "leave_pickup_shift_blank_unless_requested",
      requested_pickup_shift_note:
        planLike.shipping_instructions?.requested_pickup_shift_note || "",
    },
    {
      action: "submit_order",
      confirmation_button: "Xac nhan tao don va giao hang",
    },
  ];
}
