function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeAscii(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

async function snapshotText(tab) {
  return tab.playwright.domSnapshot();
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
      const input = tab.playwright.getByPlaceholder("Tìm theo tên, SĐT, mã khách hàng ... (F4)", {
        exact: true,
      });
      await fillSingle(tab, input, step.phone || "");
      await waitForStableUi(tab);
    },

    async selectExistingCustomerIfShown(step, context) {
      const expectedName = normalizeText(step.customer_name);
      const expectedPhone = normalizeText(
        context?.executionPlan?.request_snapshot?.customer?.phone ||
        context?.payload?.customer?.phone ||
        "",
      );
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
      });

      const snap = await snapshotText(tab);
      const menuItems = menuReady?.menuItems || tab.playwright.getByRole("menuitem");
      const menuCount = menuReady?.menuCount ?? (await menuItems.count());

      if (menuCount === 1) {
        await menuItems.click();
        await waitForStableUi(tab);
        return;
      }

      if (menuCount >= 1 && expectedPhone) {
        const phoneCandidate = menuReady?.phoneCandidate || tab.playwright.getByText(expectedPhone, { exact: false });
        const phoneCount = menuReady?.phoneCount ?? (await phoneCandidate.count());
        if (phoneCount === 1) {
          await phoneCandidate.click();
          await waitForStableUi(tab);
          return;
        }

        if (menuCount === 1) {
          await menuItems.click();
          await waitForStableUi(tab);
          return;
        }
      }

      if (expectedName && snap.includes(expectedName)) {
        return;
      }

      if (
        expectedPhone &&
        snap.includes(expectedPhone) &&
        (snap.includes("Địa chỉ giao hàng") || snap.includes("Thong tin khach hang"))
      ) {
        return;
      }

      const candidate = tab.playwright.getByText(expectedName, { exact: false });
      const count = await candidate.count();
      if (count === 1) {
        await candidate.click();
        await waitForStableUi(tab);
        return;
      }

      throw new Error(
        `Could not confirm or select existing customer: ${expectedName}${expectedPhone ? ` (${expectedPhone})` : ""}`,
      );
    },

    async createCustomerIfMissing() {
      throw new Error("Live customer-creation handler is not wired yet. Use existing-customer requests first.");
    },

    async ensureShippingAddress(step) {
      const address = step.address || {};
      const snap = normalizeAscii(await snapshotText(tab));
      const requiredParts = [
        normalizeAscii(address.address_detail),
        normalizeAscii(address.ward),
        normalizeAscii(address.district),
        normalizeAscii(address.province),
      ].filter(Boolean);

      const missing = requiredParts.filter((part) => !snap.includes(part));
      if (missing.length > 0) {
        throw new Error(`Shipping address does not match expected normalized address. Missing: ${missing.join(", ")}`);
      }
    },

    async addProductBySku(step) {
      const input = tab.playwright.getByPlaceholder("Tìm theo tên, mã SKU, hoặc quét mã Barcode...(F3)", {
        exact: true,
      });
      await fillSingle(tab, input, step.sku || "");
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

        const quantityInputs = row.locator('input');
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
      await clickSingle(tab, button);
      await waitForStableUi(tab);
    },

    async setCustomerTotal(step, context) {
      if (!Array.isArray(context?.items) || context.items.length === 0) {
        throw new Error("Cannot adjust customer total without item context.");
      }

      const desiredTotal = Number(step.amount || 0);
      const items = context.items;
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

      const runningTotal = inspected.reduce(
        (sum, item) => sum + item.quantity * item.currentUnitPrice,
        0,
      );
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
      await fillSingle(tab, codInput, String(step.amount || 0));
      await waitForStableUi(tab);
    },

    async setDeclaredPackageValue(step) {
      const declared = tab.playwright.getByLabel("Khai báo giá trị gói hàng", { exact: true });
      await fillSingle(tab, declared, String(step.amount || 0));
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
