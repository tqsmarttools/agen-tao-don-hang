const productCatalogPath = "../../data/product-catalog.json";
const addressCatalogPath = "../../data/address-catalog.json";
const customerIndexPath = "../../data/customer-index.json";
const aiStatusPath = "../../data/ai-request-status.json";
const publicConfigPath = "../../data/phone-order-public-config.json";
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
  showInboxSetup: false,
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
const opsPanel = document.querySelector("#opsPanel");
const payloadPanel = document.querySelector("#payloadPanel");
const opsPanelHeading = opsPanel?.querySelector(".panel-heading");
const inboxConfigPanel = opsPanel?.querySelector(".inbox-config");
const queueActionsPanel = opsPanel?.querySelector(".queue-actions");
const hiddenCompletionStatuses = new Set();

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeAscii(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatCurrencyInput(value) {
  const digits = digitsOnly(value);
  if (!digits) {
    return "";
  }

  return Number(digits).toLocaleString("vi-VN");
}

function shippingInstructionsFromNote(note) {
  const rawNote = normalizeText(note);
  const normalizedNote = normalizeAscii(rawNote);
  const mentionsPickupShift =
    normalizedNote.includes("ca lay hang") ||
    normalizedNote.includes("ca lay") ||
    normalizedNote.includes("lay hang");

  return {
    requires_manual_pickup_shift: mentionsPickupShift,
    requested_pickup_shift_note: mentionsPickupShift ? rawNote : "",
  };
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
  if (normalizeText(inboxUrlInput.value) && normalizeText(inboxKeyInput.value)) {
    state.showInboxSetup = false;
  }
  syncAdvancedPanels();
}

function currentInboxConfig() {
  return {
    inbox_url: normalizeText(inboxUrlInput.value),
    inbox_key: normalizeText(inboxKeyInput.value),
  };
}

function remoteInboxReadUrl(config = currentInboxConfig()) {
  if (!config.inbox_url || !config.inbox_key) {
    return "";
  }

  const separator = config.inbox_url.includes("?") ? "&" : "?";
  return `${config.inbox_url}${separator}inbox_key=${encodeURIComponent(config.inbox_key)}`;
}

function syncAdvancedPanels() {
  const config = currentInboxConfig();
  const hasInboxConfig = Boolean(config.inbox_url && config.inbox_key);
  const hasQueuedRequests = visibleQueueRequests().length > 0;
  const showAdvanced = isDebugMode() || state.showInboxSetup;
  const showStatusPanel = hasQueuedRequests || showAdvanced;
  const setVisibility = (element, visible) => {
    if (!element) {
      return;
    }

    element.hidden = !visible;
    element.style.display = visible ? "" : "none";
  };

  if (opsPanel) {
    opsPanel.hidden = !showStatusPanel;
    opsPanel.style.display = showStatusPanel ? "" : "none";
    opsPanel.classList.toggle("status-only", showStatusPanel && !showAdvanced);
  }

  if (payloadPanel) {
    setVisibility(payloadPanel, showAdvanced);
  }

  setVisibility(opsPanelHeading, showAdvanced);
  setVisibility(inboxConfigPanel, showAdvanced);
  setVisibility(queueActionsPanel, showAdvanced);
  setVisibility(queueMessage, showAdvanced);
}

function productSearchHaystack(item) {
  return [item.sku, item.barcode, item.product_name, item.variant_name, item.display_name]
    .concat(item.keywords || [])
    .join(" ")
    .toLowerCase();
}

function isLocalhostRuntime() {
  return ["127.0.0.1", "localhost"].includes(window.location.hostname);
}

function isDebugMode() {
  return new URLSearchParams(window.location.search).get("debug") === "1";
}

function localInboxEndpoint() {
  return `${window.location.origin}/__local_ai_inbox`;
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
  const config = currentInboxConfig();
  const remoteReadUrl =
    !isLocalhostRuntime() && config.inbox_url && config.inbox_key
      ? remoteInboxReadUrl(config)
      : "";

  try {
    const response = await fetch(remoteReadUrl || `${aiStatusPath}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    return Array.isArray(payload.requests) ? payload.requests : [];
  } catch (error) {
    return [];
  }
}

async function loadPublicInboxConfig() {
  try {
    const response = await fetch(`${publicConfigPath}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    return {
      inbox_url: normalizeText(payload.inbox_url),
      inbox_key: normalizeText(payload.inbox_key),
    };
  } catch (error) {
    return { inbox_url: "", inbox_key: "" };
  }
}

async function refreshAiStatuses() {
  const aiStatuses = await loadAiStatuses();
  state.aiStatuses = new Map(
    aiStatuses.map((request) => [request.request_id, request]),
  );
  renderQueue();
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
  if (request?.execution_result?.status) {
    return request.execution_result.status;
  }

  const synced = state.aiStatuses.get(request.request_id);
  return synced?.status || request.status;
}

function effectiveRequestMessage(request) {
  const synced = state.aiStatuses.get(request.request_id);
  return synced?.message || "";
}

function visibleQueueRequests() {
  return [...state.aiQueue]
    .reverse()
    .filter((request) => !hiddenCompletionStatuses.has(effectiveRequestStatus(request)));
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
  const note = normalizeText(orderNoteInput.value);

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
    order_total_including_shipping: Number(digitsOnly(orderTotalInput.value) || 0),
    note,
    admin_directives: {
      shipping: shippingInstructionsFromNote(note),
    },
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
  syncAdvancedPanels();
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
  syncAdvancedPanels();
  const visibleRequests = visibleQueueRequests();
  if (visibleRequests.length === 0) {
    queueItemsContainer.className = "selected-items empty-state";
    queueItemsContainer.textContent = "Chua co don hang nao dang cho xu ly.";
    return;
  }

  queueItemsContainer.className = "selected-items";
  queueItemsContainer.innerHTML = "";

  for (const request of visibleRequests) {
    const effectiveStatus = effectiveRequestStatus(request);
    const effectiveMessage = effectiveRequestMessage(request);
    const card = document.createElement("article");
    card.className = "selected-card";
    if (effectiveStatus === "created") {
      card.classList.add("queue-card-created");
    }
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

async function sendRequestsToInbox(requests) {
  const config = currentInboxConfig();
  const useLocalInbox = isLocalhostRuntime() && (!config.inbox_url || !config.inbox_key);

  if (!useLocalInbox && (!config.inbox_url || !config.inbox_key)) {
    return {
      ok: false,
      reason: "missing_config",
      message: "Can nhap inbox URL va inbox key.",
    };
  }

  saveInboxConfig();

  if (!Array.isArray(requests) || requests.length === 0) {
    return {
      ok: false,
      reason: "empty_requests",
      message: "Queue dang rong, chua co gi de gui.",
    };
  }

  const body = {
    inbox_key: useLocalInbox ? "local-dev-inbox" : config.inbox_key,
    source: "dashboard-phone-order",
    payload: {
      schema: aiQueueSchema,
      exported_at: new Date().toISOString(),
      request_count: requests.length,
      requests,
    },
  };

  try {
    const response = await fetch(useLocalInbox ? localInboxEndpoint() : config.inbox_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return {
      ok: true,
      message: useLocalInbox
        ? `Da gui ${requests.length} yeu cau vao local inbox tren may nay.`
        : `Da gui ${requests.length} yeu cau len inbox.`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "send_failed",
      message: `Gui inbox that bai: ${error.message}`,
    };
  }
}

async function sendQueueToInbox() {
  const result = await sendRequestsToInbox(state.aiQueue);
  queueMessage.textContent = result.message;
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

async function addCurrentRequestToQueue() {
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

  const sendResult = await sendRequestsToInbox([request]);
  if (sendResult.ok) {
    await refreshAiStatuses();
    formMessage.textContent =
      isLocalhostRuntime()
        ? "Da gui yeu cau tao don vao local inbox tren may nay. Co the nhap don tiep theo."
        : "Da gui yeu cau tao don len inbox. Co the nhap don tiep theo.";
    queueMessage.textContent = sendResult.message;
    return;
  }

  if (sendResult.reason === "missing_config") {
    state.showInboxSetup = true;
    syncAdvancedPanels();
    formMessage.textContent =
      "Da luu yeu cau tren may nay, nhung chua gui inbox vi thieu inbox URL hoac inbox key.";
    queueMessage.textContent = sendResult.message;
    return;
  }

  formMessage.textContent =
    "Da luu yeu cau tren may nay, nhung gui inbox that bai. Kiem tra ket noi va thu lai.";
  queueMessage.textContent = sendResult.message;
}

async function initialize() {
  const [productCatalog, addressCatalog, customerIndex, aiStatuses, publicInboxConfig] = await Promise.all([
    loadProductCatalog(),
    loadAddressCatalog(),
    loadCustomerIndex(),
    loadAiStatuses(),
    loadPublicInboxConfig(),
  ]);

  state.productCatalog = productCatalog;
  state.addressCatalog = addressCatalog;
  state.customers = customerIndex;
  state.aiQueue = loadAiQueue();
  state.aiStatuses = new Map(
    aiStatuses.map((request) => [request.request_id, request]),
  );

  const savedInboxConfig = loadInboxConfig();
  const inboxConfig =
    savedInboxConfig.inbox_url && savedInboxConfig.inbox_key
      ? savedInboxConfig
      : publicInboxConfig;
  inboxUrlInput.value = inboxConfig.inbox_url || "";
  inboxKeyInput.value = inboxConfig.inbox_key || "";
  if (inboxConfig.inbox_url && inboxConfig.inbox_key) {
    saveInboxConfig();
  }

  populateProvinceOptions();
  renderProductResults("");
  renderSelectedItems();
  renderQueue();
  renderPayloadPreview();
  syncAdvancedPanels();

  if ("serviceWorker" in navigator) {
    if (isLocalhostRuntime()) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      } catch (error) {
        console.error("Cannot clear local service workers", error);
      }
    } else {
      try {
        await navigator.serviceWorker.register("./sw.js");
      } catch (error) {
        console.error("Cannot register service worker", error);
      }
    }
  }

  if (isLocalhostRuntime()) {
    window.setInterval(() => {
      refreshAiStatuses().catch((error) => {
        console.error("Cannot refresh AI statuses", error);
      });
    }, 5000);
  } else {
    window.setInterval(() => {
      const config = currentInboxConfig();
      if (!config.inbox_url || !config.inbox_key) {
        return;
      }

      refreshAiStatuses().catch((error) => {
        console.error("Cannot refresh live inbox statuses", error);
      });
    }, 5000);
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
orderTotalInput.addEventListener("input", (event) => {
  const start = event.target.selectionStart || 0;
  const beforeLength = event.target.value.length;
  event.target.value = formatCurrencyInput(event.target.value);
  const afterLength = event.target.value.length;
  const nextPosition = Math.max(0, start + (afterLength - beforeLength));
  event.target.setSelectionRange(nextPosition, nextPosition);
  renderPayloadPreview();
});
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
