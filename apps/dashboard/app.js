const productCatalogPath = "../../data/product-catalog.json";
const addressCatalogPath = "../../data/address-catalog.json";
const customerIndexPath = "../../data/customer-index.json";
const aiStatusPath = "../../data/ai-request-status.json";
const aiQueueStorageKey = "tq-sapo-phone-order-ai-queue-v1";
const aiInboxConfigStorageKey = "tq-sapo-phone-order-inbox-config-v1";
const aiQueueSchema = "tq-sapo-phone-order-request-queue/v1";

const fallbackCustomers = [];

const fallbackAddressCatalog = {
  provinces: [
    {
      code: "hcm",
      name: "TP Ho Chi Minh",
      districts: [
        {
          code: "thu-duc",
          name: "Thanh pho Thu Duc",
          wards: [
            { code: "hiep-binh-chanh", name: "Phuong Hiep Binh Chanh" },
            { code: "linh-dong", name: "Phuong Linh Dong" },
          ],
        },
        {
          code: "binh-tan",
          name: "Quan Binh Tan",
          wards: [
            { code: "binh-tri-dong", name: "Phuong Binh Tri Dong" },
            { code: "an-lac", name: "Phuong An Lac" },
          ],
        },
      ],
    },
    {
      code: "dong-nai",
      name: "Dong Nai",
      districts: [
        {
          code: "trang-bom",
          name: "Trang Bom",
          wards: [
            { code: "bac-son", name: "Xa Bac Son" },
            { code: "ho-nai-3", name: "Xa Ho Nai 3" },
          ],
        },
      ],
    },
  ],
};

const state = {
  productCatalog: [],
  customers: fallbackCustomers,
  addressCatalog: fallbackAddressCatalog,
  selectedItems: [],
  aiQueue: [],
  aiStatuses: new Map(),
};

const customerPhoneInput = document.querySelector("#customerPhone");
const customerNameInput = document.querySelector("#customerName");
const customerSuggestions = document.querySelector("#customerSuggestions");
const provinceSelect = document.querySelector("#provinceSelect");
const districtSelect = document.querySelector("#districtSelect");
const wardSelect = document.querySelector("#wardSelect");
const addressDetailInput = document.querySelector("#addressDetail");
const productSearchInput = document.querySelector("#productSearch");
const productResults = document.querySelector("#productResults");
const selectedItemsContainer = document.querySelector("#selectedItems");
const orderTotalInput = document.querySelector("#orderTotal");
const orderNoteInput = document.querySelector("#orderNote");
const payloadPreview = document.querySelector("#payloadPreview");
const queueRequestButton = document.querySelector("#queueRequest");
const formMessage = document.querySelector("#formMessage");
const queueItemsContainer = document.querySelector("#queueItems");
const queueMessage = document.querySelector("#queueMessage");
const copyQueueButton = document.querySelector("#copyQueue");
const downloadQueueButton = document.querySelector("#downloadQueue");
const clearQueueButton = document.querySelector("#clearQueue");
const sendQueueButton = document.querySelector("#sendQueue");
const inboxUrlInput = document.querySelector("#inboxUrl");
const inboxKeyInput = document.querySelector("#inboxKey");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function loadAiQueue() {
  try {
    const raw = localStorage.getItem(aiQueueStorageKey);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function saveAiQueue() {
  localStorage.setItem(aiQueueStorageKey, JSON.stringify(state.aiQueue));
}

function loadInboxConfig() {
  try {
    const raw = localStorage.getItem(aiInboxConfigStorageKey);
    return raw ? JSON.parse(raw) : { inbox_url: "", inbox_key: "" };
  } catch (error) {
    return { inbox_url: "", inbox_key: "" };
  }
}

function saveInboxConfig() {
  localStorage.setItem(
    aiInboxConfigStorageKey,
    JSON.stringify({
      inbox_url: normalizeText(inboxUrlInput.value),
      inbox_key: normalizeText(inboxKeyInput.value),
    }),
  );
}

function productSearchHaystack(item) {
  return [item.sku, item.barcode, item.product_name, item.variant_name, item.display_name]
    .concat(item.keywords || [])
    .join(" ")
    .toLowerCase();
}

async function loadProductCatalog() {
  try {
    const response = await fetch(productCatalogPath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    return Array.isArray(payload.items) ? payload.items.filter((item) => item.active) : [];
  } catch (error) {
    formMessage.textContent =
      "Khong tai duoc product catalog tu file local, dang dung du lieu da export neu browser cho phep.";
    return [];
  }
}

async function loadAddressCatalog() {
  try {
    const response = await fetch(addressCatalogPath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();

    const provinces = Array.isArray(payload.provinces)
      ? payload.provinces.map((province) => {
          const districts = Array.isArray(payload.districts)
            ? payload.districts
                .filter((district) => Number(district.province_id) === Number(province.province_id))
                .map((district) => {
                  const wards = Array.isArray(payload.wards_by_district_id?.[String(district.district_id)])
                    ? payload.wards_by_district_id[String(district.district_id)].map((ward) => ({
                        code: ward.ward_code,
                        name: ward.name,
                      }))
                    : [];

                  return {
                    code: String(district.district_id),
                    name: district.name,
                    wards,
                  };
                })
            : [];

          return {
            code: String(province.province_id),
            name: province.name,
            districts,
          };
        })
      : [];

    return provinces.length > 0 ? { provinces } : fallbackAddressCatalog;
  } catch (error) {
    return fallbackAddressCatalog;
  }
}

async function loadCustomerIndex() {
  try {
    const response = await fetch(customerIndexPath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    return Array.isArray(payload.customers) && payload.customers.length > 0
      ? payload.customers
      : fallbackCustomers;
  } catch (error) {
    return fallbackCustomers;
  }
}

async function loadAiStatuses() {
  try {
    const response = await fetch(aiStatusPath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    return Array.isArray(payload.requests) ? payload.requests : [];
  } catch (error) {
    return [];
  }
}

function populateProvinceOptions() {
  for (const province of state.addressCatalog.provinces) {
    const option = document.createElement("option");
    option.value = province.code;
    option.textContent = province.name;
    provinceSelect.append(option);
  }
}

function setDistrictOptions(provinceCode) {
  districtSelect.innerHTML = '<option value="">Chọn quận / huyện</option>';
  wardSelect.innerHTML = '<option value="">Chọn phường / xã</option>';
  wardSelect.disabled = true;

  const province = state.addressCatalog.provinces.find((item) => item.code === provinceCode);
  districtSelect.disabled = !province;

  if (!province) {
    return;
  }

  for (const district of province.districts) {
    const option = document.createElement("option");
    option.value = district.code;
    option.textContent = district.name;
    districtSelect.append(option);
  }
}

function setWardOptions(provinceCode, districtCode) {
  wardSelect.innerHTML = '<option value="">Chọn phường / xã</option>';

  const province = state.addressCatalog.provinces.find((item) => item.code === provinceCode);
  const district = province?.districts.find((item) => item.code === districtCode);
  wardSelect.disabled = !district;

  if (!district) {
    return;
  }

  for (const ward of district.wards) {
    const option = document.createElement("option");
    option.value = ward.code;
    option.textContent = ward.name;
    wardSelect.append(option);
  }
}

function selectedProvince() {
  return state.addressCatalog.provinces.find((item) => item.code === provinceSelect.value);
}

function selectedDistrict() {
  return selectedProvince()?.districts.find((item) => item.code === districtSelect.value);
}

function selectedWard() {
  return selectedDistrict()?.wards.find((item) => item.code === wardSelect.value);
}

function renderCustomerSuggestions(phone) {
  const normalized = normalizePhone(phone);
  const matches = normalized.length >= 4
    ? state.customers.filter((item) => normalizePhone(item.phone).includes(normalized))
    : [];

  customerSuggestions.innerHTML = "";
  customerSuggestions.hidden = matches.length === 0;

  for (const match of matches.slice(0, 3)) {
    const card = document.createElement("article");
    card.className = "suggestion-card";

    const address = match.addresses[0];
    card.innerHTML = `
      <strong>${match.customer_name}</strong>
      <div class="meta">SDT: ${match.phone}</div>
      <div class="helper">Da mua ${match.order_count} lan</div>
      <div class="helper">${address.address_detail}, ${address.ward}, ${address.district}, ${address.province}</div>
      <div class="suggestion-actions">
        <button class="ghost-button" type="button">Dung thong tin nay</button>
      </div>
    `;

    card.querySelector("button").addEventListener("click", () => {
      customerNameInput.value = match.customer_name;
      applyAddress(address);
      customerSuggestions.hidden = true;
    });

    customerSuggestions.append(card);
  }
}

function applyAddress(address) {
  const province = state.addressCatalog.provinces.find((item) => item.name === address.province);
  provinceSelect.value = province?.code || "";
  setDistrictOptions(provinceSelect.value);

  const district = province?.districts.find((item) => item.name === address.district);
  districtSelect.value = district?.code || "";
  setWardOptions(provinceSelect.value, districtSelect.value);

  const ward = district?.wards.find((item) => item.name === address.ward);
  wardSelect.value = ward?.code || "";
  addressDetailInput.value = address.address_detail || "";
}

function renderProductResults(query) {
  const normalized = normalizeText(query).toLowerCase();

  if (!normalized) {
    productResults.className = "product-results empty-state";
    productResults.textContent = "Gõ SKU hoặc tên sản phẩm để bắt đầu tìm.";
    return;
  }

  const matches = state.productCatalog
    .filter((item) => productSearchHaystack(item).includes(normalized))
    .slice(0, 8);

  if (matches.length === 0) {
    productResults.className = "product-results empty-state";
    productResults.textContent = "Khong tim thay san pham phu hop.";
    return;
  }

  productResults.className = "product-results";
  productResults.innerHTML = "";

  for (const product of matches) {
    const card = document.createElement("article");
    card.className = "product-card";
    card.innerHTML = `
      <strong>${product.display_name}</strong>
      <div class="meta">SKU: ${product.sku || "Chua co SKU"}</div>
      <div class="product-card-footer">
        <button class="mini-button" type="button">Chon san pham</button>
      </div>
    `;

    card.querySelector("button").addEventListener("click", () => addSelectedItem(product));
    productResults.append(card);
  }
}

function addSelectedItem(product) {
  const existing = state.selectedItems.find((item) => item.variant_id === product.variant_id);
  if (existing) {
    existing.quantity += 1;
  } else {
    state.selectedItems.push({
      variant_id: product.variant_id,
      sku: product.sku,
      name: product.display_name,
      quantity: 1,
    });
  }

  renderSelectedItems();
}

function updateItemQuantity(variantId, quantity) {
  const item = state.selectedItems.find((entry) => entry.variant_id === variantId);
  if (!item) {
    return;
  }
  item.quantity = Math.max(1, Number(quantity) || 1);
}

function removeSelectedItem(variantId) {
  state.selectedItems = state.selectedItems.filter((item) => item.variant_id !== variantId);
  renderSelectedItems();
}

function renderSelectedItems() {
  if (state.selectedItems.length === 0) {
    selectedItemsContainer.className = "selected-items empty-state";
    selectedItemsContainer.textContent = "Chưa có sản phẩm nào được chọn.";
    return;
  }

  selectedItemsContainer.className = "selected-items";
  selectedItemsContainer.innerHTML = "";

  for (const item of state.selectedItems) {
    const card = document.createElement("article");
    card.className = "selected-card";
    card.innerHTML = `
      <strong>${item.name}</strong>
      <div class="meta">SKU: ${item.sku || "Chua co SKU"}</div>
      <div class="quantity-row">
        <label>
          <span>So luong</span>
          <input type="number" min="1" step="1" value="${item.quantity}" />
        </label>
      </div>
      <div class="selected-card-footer">
        <button class="remove-button" type="button">Bo san pham</button>
      </div>
    `;

    const quantityInput = card.querySelector("input");
    quantityInput.addEventListener("input", (event) => {
      updateItemQuantity(item.variant_id, event.target.value);
      renderPayloadPreview();
    });

    card.querySelector("button").addEventListener("click", () => {
      removeSelectedItem(item.variant_id);
      renderPayloadPreview();
    });

    selectedItemsContainer.append(card);
  }
}

function effectiveRequestStatus(request) {
  const synced = state.aiStatuses.get(request.request_id);
  return synced?.status || request.status;
}

function effectiveRequestMessage(request) {
  const synced = state.aiStatuses.get(request.request_id);
  return synced?.message || "";
}

function currentRequestPayload() {
  const payload = buildPayload();
  return {
    request_id: `${payload.customer.phone || "guest"}-${Date.now()}`,
    status: "pending_ai",
    requested_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    customer: payload.customer,
    address: payload.address,
    items: payload.items,
    order_total_including_shipping: payload.order_total_including_shipping,
    note: payload.note,
  };
}

function payloadAddress() {
  return {
    province: selectedProvince()?.name || "",
    district: selectedDistrict()?.name || "",
    ward: selectedWard()?.name || "",
    address_detail: normalizeText(addressDetailInput.value),
  };
}

function buildPayload() {
  return {
    schema: "tq-sapo-phone-order-request/v1",
    requested_at: new Date().toISOString(),
    customer: {
      phone: normalizePhone(customerPhoneInput.value),
      name: normalizeText(customerNameInput.value),
    },
    address: payloadAddress(),
    items: state.selectedItems.map((item) => ({
      variant_id: item.variant_id,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
    })),
    order_total_including_shipping: Number(orderTotalInput.value || 0),
    note: normalizeText(orderNoteInput.value),
  };
}

function validatePayload(payload) {
  if (!payload.customer.phone) {
    return "Can nhap so dien thoai.";
  }
  if (!payload.customer.name) {
    return "Can nhap ten khach.";
  }
  if (!payload.address.province || !payload.address.district || !payload.address.ward) {
    return "Can chon day du tinh, huyen, xa.";
  }
  if (!payload.address.address_detail) {
    return "Can nhap dia chi cu the.";
  }
  if (payload.items.length === 0) {
    return "Can chon it nhat mot san pham.";
  }
  if (!payload.order_total_including_shipping) {
    return "Can nhap tong gia tri don hang.";
  }
  return "";
}

function queuePayload() {
  return {
    schema: aiQueueSchema,
    exported_at: new Date().toISOString(),
    request_count: state.aiQueue.length,
    requests: state.aiQueue,
  };
}

function renderPayloadPreview() {
  const payload = buildPayload();
  payloadPreview.textContent = JSON.stringify(payload, null, 2);
}

function resetEntryForm() {
  customerPhoneInput.value = "";
  customerNameInput.value = "";
  customerSuggestions.innerHTML = "";
  customerSuggestions.hidden = true;

  provinceSelect.value = "";
  districtSelect.innerHTML = '<option value="">Chọn quận / huyện</option>';
  districtSelect.disabled = true;
  wardSelect.innerHTML = '<option value="">Chọn phường / xã</option>';
  wardSelect.disabled = true;
  addressDetailInput.value = "";

  productSearchInput.value = "";
  state.selectedItems = [];
  renderSelectedItems();
  renderProductResults("");

  orderTotalInput.value = "";
  orderNoteInput.value = "";
}

function renderQueue() {
  if (state.aiQueue.length === 0) {
    queueItemsContainer.className = "selected-items empty-state";
    queueItemsContainer.textContent = "Chưa có yêu cầu nào trong queue.";
    return;
  }

  queueItemsContainer.className = "selected-items";
  queueItemsContainer.innerHTML = "";

  for (const request of [...state.aiQueue].reverse()) {
    const effectiveStatus = effectiveRequestStatus(request);
    const effectiveMessage = effectiveRequestMessage(request);
    const card = document.createElement("article");
    card.className = "selected-card";
    card.innerHTML = `
      <div class="queue-card-top">
        <strong>${request.customer.name || "Chua co ten khach"}</strong>
        <span class="queue-status">${effectiveStatus}</span>
      </div>
      <div class="meta">SDT: ${request.customer.phone || "Chua co SDT"}</div>
      <div class="helper">${request.items.length} san pham - Tong ${request.order_total_including_shipping.toLocaleString("vi-VN")} VND</div>
      <div class="helper">${request.address.address_detail}, ${request.address.ward}, ${request.address.district}, ${request.address.province}</div>
      <div class="helper">Tao luc: ${new Date(request.requested_at).toLocaleString("vi-VN")}</div>
      ${effectiveMessage ? `<div class="helper">${effectiveMessage}</div>` : ""}
    `;

    queueItemsContainer.append(card);
  }
}

async function copyText(value) {
  const text = String(value || "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function sendQueueToInbox() {
  const config = {
    inbox_url: normalizeText(inboxUrlInput.value),
    inbox_key: normalizeText(inboxKeyInput.value),
  };

  if (!config.inbox_url || !config.inbox_key) {
    queueMessage.textContent = "Can nhap inbox URL va inbox key.";
    return;
  }

  saveInboxConfig();

  if (state.aiQueue.length === 0) {
    queueMessage.textContent = "Queue dang rong, chua co gi de gui.";
    return;
  }

  const body = {
    inbox_key: config.inbox_key,
    source: "dashboard-phone-order",
    payload: queuePayload(),
  };

  try {
    const response = await fetch(config.inbox_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    queueMessage.textContent = `Da gui ${state.aiQueue.length} yeu cau len inbox.`;
  } catch (error) {
    queueMessage.textContent = `Gui inbox that bai: ${error.message}`;
  }
}

function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function addCurrentRequestToQueue() {
  const payload = buildPayload();
  const validationError = validatePayload(payload);

  payloadPreview.textContent = JSON.stringify(payload, null, 2);
  if (validationError) {
    formMessage.textContent = validationError;
    return;
  }

  const request = currentRequestPayload();
  state.aiQueue.push(request);
  saveAiQueue();
  renderQueue();
  payloadPreview.textContent = JSON.stringify(queuePayload(), null, 2);
  resetEntryForm();
  renderPayloadPreview();
  formMessage.textContent = "Da gui yeu cau tao don. Co the nhap don tiep theo.";
  queueMessage.textContent = `Queue hien co ${state.aiQueue.length} yeu cau.`;
}

async function initialize() {
  const [productCatalog, addressCatalog, customerIndex, aiStatuses] = await Promise.all([
    loadProductCatalog(),
    loadAddressCatalog(),
    loadCustomerIndex(),
    loadAiStatuses(),
  ]);

  state.productCatalog = productCatalog;
  state.addressCatalog = addressCatalog;
  state.customers = customerIndex;
  state.aiQueue = loadAiQueue();
  state.aiStatuses = new Map(
    aiStatuses.map((request) => [request.request_id, request]),
  );

  const inboxConfig = loadInboxConfig();
  inboxUrlInput.value = inboxConfig.inbox_url || "";
  inboxKeyInput.value = inboxConfig.inbox_key || "";

  populateProvinceOptions();
  renderProductResults("");
  renderSelectedItems();
  renderQueue();
  renderPayloadPreview();

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (error) {
      console.error("Cannot register service worker", error);
    }
  }
}

customerPhoneInput.addEventListener("input", (event) => {
  renderCustomerSuggestions(event.target.value);
  renderPayloadPreview();
});

customerNameInput.addEventListener("input", renderPayloadPreview);
provinceSelect.addEventListener("change", () => {
  setDistrictOptions(provinceSelect.value);
  renderPayloadPreview();
});
districtSelect.addEventListener("change", () => {
  setWardOptions(provinceSelect.value, districtSelect.value);
  renderPayloadPreview();
});
wardSelect.addEventListener("change", renderPayloadPreview);
addressDetailInput.addEventListener("input", renderPayloadPreview);
productSearchInput.addEventListener("input", (event) => renderProductResults(event.target.value));
orderTotalInput.addEventListener("input", renderPayloadPreview);
orderNoteInput.addEventListener("input", renderPayloadPreview);

queueRequestButton.addEventListener("click", addCurrentRequestToQueue);

copyQueueButton.addEventListener("click", async () => {
  await copyText(JSON.stringify(queuePayload(), null, 2));
  queueMessage.textContent = "Da copy queue JSON.";
});

sendQueueButton.addEventListener("click", sendQueueToInbox);

downloadQueueButton.addEventListener("click", () => {
  downloadJson("sapo-phone-order-queue.json", queuePayload());
  queueMessage.textContent = "Da tai queue JSON.";
});

clearQueueButton.addEventListener("click", () => {
  state.aiQueue = [];
  saveAiQueue();
  renderQueue();
  payloadPreview.textContent = JSON.stringify(buildPayload(), null, 2);
  queueMessage.textContent = "Da xoa queue local.";
});

inboxUrlInput.addEventListener("change", saveInboxConfig);
inboxKeyInput.addEventListener("change", saveInboxConfig);

initialize();
