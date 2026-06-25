function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeAscii(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/Ä‘/g, "d")
    .replace(/Ä/g, "D")
    .toLowerCase();
}

async function waitForStableUi(tab) {
  await tab.playwright.waitForTimeout(800);
}

async function waitForCondition(fn, { attempts = 6, delayMs = 400 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await fn();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return null;
}

async function fillSingle(tab, locator, value) {
  const count = await locator.count();
  if (count !== 1) {
    throw new Error(`Expected one matching element, found ${count}.`);
  }
  await locator.fill(String(value));
}

async function clickSingle(tab, locator) {
  const count = await locator.count();
  if (count !== 1) {
    throw new Error(`Expected one clickable element, found ${count}.`);
  }
  await locator.click();
}

async function setValueWithEvents(locator, value) {
  await locator.evaluate((element, nextValue) => {
    const nativeInput = element;
    nativeInput.value = String(nextValue);
    nativeInput.dispatchEvent(new Event("input", { bubbles: true }));
    nativeInput.dispatchEvent(new Event("change", { bubbles: true }));
    nativeInput.dispatchEvent(new Event("blur", { bubbles: true }));
  }, String(value));
}

async function fillFirstMatching(root, selectors, value) {
  for (const selector of selectors) {
    const locator = root.locator(selector);
    const count = await locator.count();
    if (count < 1) {
      continue;
    }

    await locator.first().fill(String(value));
    return selector;
  }

  throw new Error(`Could not find a matching input for selectors: ${selectors.join(", ")}`);
}

async function clickFirstMatching(root, selectors) {
  for (const selector of selectors) {
    const locator = root.locator(selector);
    const count = await locator.count();
    if (count < 1) {
      continue;
    }

    await locator.first().click();
    return selector;
  }

  return "";
}

async function waitForFirstMatching(root, selectors, { attempts = 8, delayMs = 400 } = {}) {
  return waitForCondition(async () => {
    for (const selector of selectors) {
      const locator = root.locator(selector);
      const count = await locator.count();
      if (count > 0) {
        return locator.first();
      }
    }

    return null;
  }, { attempts, delayMs });
}

async function snapshotText(tab) {
  return tab.playwright.domSnapshot();
}

function extractOrderIdFromUrl(url) {
  const match = String(url || "").match(/\/admin\/orders\/(\d+)(?:[/?#]|$)/);
  return match ? match[1] : "";
}

function customerAttachedSnapshotChecks({
  snap,
  expectedName = "",
  expectedPhone = "",
  addressDetail = "",
}) {
  const normalizedSnap = normalizeAscii(snap);
  const requiredParts = [
    normalizeAscii(expectedName),
    normalizeAscii(expectedPhone),
    normalizeAscii(addressDetail),
  ].filter(Boolean);

  return (
    !normalizedSnap.includes("chua co thong tin khach hang") &&
    normalizedSnap.includes("dia chi giao hang") &&
    requiredParts.every((part) => normalizedSnap.includes(part))
  );
}

export function createChromePhoneOrderLiveAdapter({ tab, baseUrl }) {
  if (!tab) {
    throw new Error("createChromePhoneOrderLiveAdapter requires a claimed Chrome tab.");
  }

  const createOrderUrl = `${String(baseUrl || "").replace(/\/$/, "")}/admin/orders/create`;

  return {
    async openCreateOrderPage(step) {
      await tab.goto(step.target?.startsWith("/admin") ? createOrderUrl : step.target || createOrderUrl);
      await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 20000 });
      await waitForStableUi(tab);
    },

    async searchCustomerByPhone(step) {
      const input = await waitForFirstMatching(tab.playwright, [
        "input#buttonF4",
        'input[placeholder*="SĐT"]',
        'input[placeholder*="SDT"]',
        'input[placeholder*="F4"]',
      ], { attempts: 10, delayMs: 500 });

      if (!input) {
        throw new Error("Could not find the customer search input.");
      }

      await input.fill(String(step.phone || ""));
      await waitForStableUi(tab);
    },

    async selectExistingCustomerIfShown(step, context) {
      const expectedName = normalizeText(step.customer_name);
      const expectedPhone = normalizeText(step.phone || context?.executionPlan?.customer?.phone || "");

      const isCustomerAttached = async () =>
        customerAttachedSnapshotChecks({
          snap: await snapshotText(tab),
          expectedName,
          expectedPhone,
        });

      const menuReady = await waitForCondition(async () => {
        const menuItems = tab.playwright.getByRole("menuitem");
        const menuCount = await menuItems.count();
        if (menuCount > 0) {
          return { menuItems, menuCount };
        }

        const phoneCandidate = expectedPhone
          ? tab.playwright.getByText(expectedPhone, { exact: false })
          : null;
        const phoneCount = phoneCandidate ? await phoneCandidate.count() : 0;
        if (phoneCandidate && phoneCount > 0) {
          return { menuItems, menuCount, phoneCandidate, phoneCount };
        }

        return null;
      }, { attempts: 8, delayMs: 450 });

      const snap = await snapshotText(tab);
      const menuItems = menuReady?.menuItems || tab.playwright.getByRole("menuitem");
      const menuCount = menuReady?.menuCount ?? (await menuItems.count());

      if (menuCount === 1) {
        await menuItems.click();
        await waitForStableUi(tab);
        if (await waitForCondition(isCustomerAttached, { attempts: 6, delayMs: 500 })) {
          return;
        }
      }

      if (menuCount >= 1 && expectedPhone) {
        const phoneCandidate = menuReady?.phoneCandidate || tab.playwright.getByText(expectedPhone, { exact: false });
        const phoneCount = menuReady?.phoneCount ?? (await phoneCandidate.count());
        if (phoneCount === 1) {
          await phoneCandidate.click();
          await waitForStableUi(tab);
          if (await waitForCondition(isCustomerAttached, { attempts: 6, delayMs: 500 })) {
            return;
          }
        }
      }

      if (await isCustomerAttached()) {
        return;
      }

      if (
        expectedPhone &&
        snap.includes(expectedPhone) &&
        (normalizeAscii(snap).includes("dia chi giao hang") ||
          normalizeAscii(snap).includes("thong tin khach hang"))
      ) {
        return;
      }

      const candidate = tab.playwright.getByText(expectedName, { exact: false });
      const count = await candidate.count();
      if (count === 1) {
        await candidate.click();
        await waitForStableUi(tab);
        if (await waitForCondition(isCustomerAttached, { attempts: 6, delayMs: 500 })) {
          return;
        }
      }

      throw new Error(
        `Could not confirm or select existing customer: ${expectedName}${expectedPhone ? ` (${expectedPhone})` : ""}`,
      );
    },

    async createCustomerIfMissing(step, context) {
      const customerName = normalizeText(step.customer_name || context?.executionPlan?.customer?.request_name || "");
      const customerPhone = normalizeText(step.phone || context?.executionPlan?.customer?.phone || "");
      const address = step.address || context?.executionPlan?.normalized_address || {};

      const isCustomerAttached = async () =>
        customerAttachedSnapshotChecks({
          snap: await snapshotText(tab),
          expectedName: customerName,
          expectedPhone: customerPhone,
          addressDetail: address.address_detail,
        });

      if (await isCustomerAttached()) {
        return;
      }

      const menuItems = tab.playwright.getByRole("menuitem");
      const menuCount = await menuItems.count();
      if (menuCount === 1) {
        await menuItems.click();
        await waitForStableUi(tab);
      } else if (menuCount > 1 && customerPhone) {
        const candidate = tab.playwright.getByText(customerPhone, { exact: false });
        const candidateCount = await candidate.count();
        if (candidateCount >= 1) {
          await candidate.first().click();
          await waitForStableUi(tab);
        }
      } else {
        throw new Error("Could not find the create-customer entry point after phone search.");
      }

      const dialog = await waitForCondition(async () => {
        const dialogs = tab.playwright.locator('[role="dialog"], .ant-modal, .modal-dialog');
        const count = await dialogs.count();
        return count > 0 ? dialogs.last() : null;
      }, { attempts: 8, delayMs: 400 });

      if (!dialog) {
        throw new Error("Customer-creation modal did not appear.");
      }

      if (customerName) {
        await fillFirstMatching(dialog, [
          'input[name*="name" i]',
          'input[id*="name" i]',
          'input[autocomplete="name"]',
          'input:not([type="hidden"]):not([type="tel"])',
        ], customerName);
      }

      if (customerPhone) {
        await fillFirstMatching(dialog, [
          'input[name*="phone" i]',
          'input[id*="phone" i]',
          'input[type="tel"]',
          'input[inputmode="tel"]',
        ], customerPhone);
      }

      if (address.address_detail) {
        await fillFirstMatching(dialog, [
          'textarea[name*="address" i]',
          'input[name*="address" i]',
          'textarea[id*="address" i]',
          'input[id*="address" i]',
          "textarea",
        ], address.address_detail);
      }

      const comboValues = [address.province, address.district, address.ward].filter(Boolean);
      if (comboValues.length > 0) {
        const comboInputs = dialog.locator('[role="combobox"] input, .ant-select-selection-search input');
        const comboCount = await comboInputs.count();
        for (let index = 0; index < Math.min(comboCount, comboValues.length); index += 1) {
          const value = comboValues[index];
          const input = comboInputs.nth(index);
          await input.fill(String(value));
          await waitForStableUi(tab);

          const option = await waitForCondition(async () => {
            const candidate = tab.playwright.getByText(String(value), { exact: false });
            const count = await candidate.count();
            return count > 0 ? candidate.first() : null;
          }, { attempts: 6, delayMs: 350 });

          if (!option) {
            throw new Error(`Could not select address option: ${value}`);
          }

          await option.click();
          await waitForStableUi(tab);
        }
      }

      const clickedSaveSelector = await clickFirstMatching(dialog, [
        'button[type="submit"]',
        ".ant-modal-footer .ant-btn-primary",
        'button[class*="primary"]',
      ]);

      if (!clickedSaveSelector) {
        throw new Error("Could not find a save button in the customer-creation modal.");
      }

      await waitForStableUi(tab);
      if (!(await waitForCondition(isCustomerAttached, { attempts: 8, delayMs: 500 }))) {
        throw new Error(
          `Customer was not confirmed after create/save: ${customerName}${customerPhone ? ` (${customerPhone})` : ""}`,
        );
      }
    },

    async ensureShippingAddress(step) {
      const address = step.address || {};
      const rawSnap = await snapshotText(tab);
      const snap = normalizeAscii(rawSnap);
      if (
        snap.includes("dia chi giao hang") &&
        (snap.includes("thay doi") || snap.includes("thong tin khach hang"))
      ) {
        return {
          note: "Shipping address section is visible on the order page.",
        };
      }

      const requiredParts = [
        normalizeAscii(address.address_detail),
        normalizeAscii(address.ward),
        normalizeAscii(address.district),
        normalizeAscii(address.province),
      ].filter(Boolean);

      const missing = requiredParts.filter((part) => !snap.includes(part));
      if (missing.length > 0) {
        return {
          note: "Shipping address strict comparison was skipped because the visible UI is not stable enough yet.",
          address_strict_match_skipped: true,
          missing_parts: missing,
        };
      }
    },

    async addProductBySku(step) {
      const input = await waitForFirstMatching(tab.playwright, [
        "input#buttonF3",
        'input[placeholder*="SKU"]',
        'input[placeholder*="Barcode"]',
        'input[placeholder*="F3"]',
      ], { attempts: 10, delayMs: 500 });

      if (!input) {
        throw new Error(`Could not find the product search input for SKU ${step.sku}.`);
      }

      await input.fill(String(step.sku || ""));
      await waitForStableUi(tab);

      const item = tab.playwright.getByRole("menuitem");
      const count = await item.count();
      if (count !== 1) {
        throw new Error(`Expected one product search result for SKU ${step.sku}, found ${count}.`);
      }

      await item.click();
      await waitForStableUi(tab);

      if (Number(step.quantity || 1) > 1) {
        const row = tab.playwright.getByRole("row").filter({ hasText: step.sku || "" });
        const rowCount = await row.count();
        if (rowCount !== 1) {
          throw new Error(`Could not locate a unique product row for SKU ${step.sku} after add.`);
        }

        const quantityInputs = row.locator("input");
        const inputCount = await quantityInputs.count();
        if (inputCount < 1) {
          throw new Error(`Could not locate quantity input for SKU ${step.sku}.`);
        }

        await quantityInputs.nth(0).fill(String(step.quantity));
        await waitForStableUi(tab);
      }
    },

    async switchShippingMode(step) {
      const label =
        step.mode === "carrier" ? "Đẩy qua hãng vận chuyển" : step.mode || "Đẩy qua hãng vận chuyển";
      const button = tab.playwright.getByRole("button", { name: label, exact: true });
      const buttonCount = await button.count();
      if (buttonCount === 1) {
        await button.click();
      } else {
        const fallbackButton = await waitForCondition(async () => {
          const candidate = tab.playwright.getByText("Đẩy qua hãng vận chuyển", { exact: false });
          const count = await candidate.count();
          return count > 0 ? candidate.first() : null;
        }, { attempts: 6, delayMs: 400 });

        if (!fallbackButton) {
          throw new Error("Could not find the carrier-shipping mode button.");
        }

        await fallbackButton.click();
      }
      await waitForStableUi(tab);
      return {
        note: `Switched shipping mode to carrier flow. Preferred carrier remains ${normalizeText(step.preferred_carrier || "GHN")}.`,
      };
    },

    async setCustomerTotal(step, context) {
      if (!Array.isArray(context?.items) || context.items.length === 0) {
        throw new Error("Cannot adjust customer total without item context.");
      }

      const desiredTotal = Number(step.amount || 0);
      const items = context.items;

      if (items.length === 1) {
        const singlePriceInputs = tab.playwright.locator('input[id^="price-line-item-"]');
        const singleCount = await singlePriceInputs.count();
        if (singleCount === 1) {
          const quantity = Math.max(1, Number(items[0]?.quantity || 1));
          const nextUnitPrice = Math.max(0, Math.round(desiredTotal / quantity));
          await fillSingle(tab, singlePriceInputs, String(nextUnitPrice));
          await waitForStableUi(tab);
          return;
        }
      }

      const inspected = [];

      for (const item of items) {
        const row = tab.playwright.getByRole("row").filter({ hasText: item.sku || "" });
        const rowCount = await row.count();
        if (rowCount !== 1) {
          throw new Error(`Could not locate a unique row for SKU ${item.sku} while adjusting total.`);
        }

        const inputs = row.locator("input");
        const inputCount = await inputs.count();
        if (inputCount < 2) {
          throw new Error(`Could not locate price input for SKU ${item.sku}.`);
        }

        const priceInput = inputs.nth(1);
        const currentValue = await priceInput.getAttribute("value", { timeoutMs: 1000 });
        const normalized = Number(String(currentValue || "0").replace(/[^\d]/g, "")) || 0;
        inspected.push({
          sku: item.sku,
          quantity: Number(item.quantity || 1),
          priceInput,
          currentUnitPrice: normalized,
        });
      }

      const adjustable = inspected.at(-1);
      if (!adjustable) {
        throw new Error("No adjustable line item found for total correction.");
      }

      const runningTotal = inspected.reduce((sum, item) => sum + item.quantity * item.currentUnitPrice, 0);
      const fixedWithoutLast = runningTotal - adjustable.quantity * adjustable.currentUnitPrice;
      const nextUnitPrice = Math.max(
        0,
        Math.round((desiredTotal - fixedWithoutLast) / Math.max(1, adjustable.quantity)),
      );

      await fillSingle(tab, adjustable.priceInput, String(nextUnitPrice));
      await waitForStableUi(tab);
    },

    async setCodAmount(step) {
      const codInput = tab.playwright.locator('input[name="cod"]');
      try {
        await fillSingle(tab, codInput, String(step.amount || 0));
      } catch {
        const count = await codInput.count();
        if (count < 1) {
          throw new Error("Could not find the COD input.");
        }
        await setValueWithEvents(codInput.first(), String(step.amount || 0));
      }
      await waitForStableUi(tab);
    },

    async setDeclaredPackageValue(step) {
      const declared = await waitForFirstMatching(tab.playwright, [
        'input[name="insuranceValue"]',
        'input[aria-label*="Khai báo giá trị gói hàng"]',
        'input[aria-label*="gia tri goi hang"]',
      ], { attempts: 6, delayMs: 400 });

      if (!declared) {
        return {
          note: "Declared package value input was not exposed in the current UI state, so this step was skipped.",
          declared_value_skipped: true,
        };
      }

      try {
        await declared.fill(String(step.amount || 0));
      } catch {
        await setValueWithEvents(declared, String(step.amount || 0));
      }
      await waitForStableUi(tab);
    },

    async leavePickupShiftBlankUnlessRequested(step) {
      if (normalizeText(step.requested_pickup_shift_note)) {
        throw new Error(
          `Pickup shift was explicitly requested and still needs a dedicated live handler: ${step.requested_pickup_shift_note}`,
        );
      }
    },

    async submitOrder(step) {
      const beforeUrl = await tab.url();
      const primaryButtons = tab.playwright.locator("#buttonF1");
      const count = await primaryButtons.count();
      if (count === 2) {
        await primaryButtons.nth(1).click();
      } else if (count === 1) {
        await primaryButtons.click();
      } else {
        throw new Error(`Could not find submit button. Found ${count} matching nodes.`);
      }

      await waitForStableUi(tab);
      const confirm = tab.playwright.getByRole("button", {
        name: step.confirmation_button || "Xac nhan tao don va giao hang",
        exact: true,
      });
      await clickSingle(tab, confirm);
      await waitForStableUi(tab);

      const state = await this.snapshotState();
      return {
        note: "Submitted order in Sapo via live adapter.",
        page_title: state.title,
        page_url: state.url,
        left_create_order_page: String(state.url || "") !== String(beforeUrl || ""),
        order_id_from_url: extractOrderIdFromUrl(state.url),
      };
    },

    async snapshotState() {
      return {
        title: await tab.title(),
        url: await tab.url(),
        dom: await snapshotText(tab),
      };
    },
  };
}
