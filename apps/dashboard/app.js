const productCatalogPath = "../../data/product-catalog.json";
const addressCatalogPath = "../../data/address-catalog.json";
const customerIndexPath = "../../data/customer-index.json";
const aiStatusPath = "../../data/ai-request-status.json";
const publicConfigPath = "../../data/phone-order-public-config.json";
const aiQueueStorageKey = "tq-sapo-phone-order-ai-queue-v1";
const aiInboxConfigStorageKey = "tq-sapo-phone-order-inbox-config-v1";
const aiQueueSchema = "tq-sapo-phone-order-request-queue/v1";
const publicDataVersion = "20260627a";
const localPendingEchoWindowMs = 10 * 60 * 1000;

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
  sharedQueue: [],
  aiStatuses: new Map(),
  showInboxSetup: false,
  lastSyncedAt: "",
  refreshInFlight: false,
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
const syncStatusText = document.querySelector("#syncStatusText");
const refreshStatusButton = document.querySelector("#refreshStatusButton");
const hiddenCompletionStatuses = new Set(["created", "cancelled"]);

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

function formatSyncTime(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) {
    return "Chua co du lieu dong bo.";
  }

  return new Date(parsed)
    .toLocaleString("vi-VN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    .replace(",", "");
}

function latestTimestamp(...values) {
  const candidates = values
    .map((value) => {
      const parsed = Date.parse(value || "");
      return Number.isFinite(parsed) ? parsed : 0;
    })
    .filter(Boolean);

  if (candidates.length === 0) {
    return "";
  }

  return new Date(Math.max(...candidates)).toISOString();
}

function renderSyncStatus() {
  if (syncStatusText) {
    syncStatusText.textContent = `Cap nhat: ${formatSyncTime(state.lastSyncedAt)}`;
  }

  if (refreshStatusButton) {
    refreshStatusButton.disabled = state.refreshInFlight;
    refreshStatusButton.textContent = state.refreshInFlight ? "Dang lam moi..." : "Lam moi";
  }
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

function runtimeStorage() {
  return isLocalhostRuntime() ? localStorage : sessionStorage;
}

function loadAiQueue() {
  try {
    const raw = runtimeStorage().getItem(aiQueueStorageKey);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function saveAiQueue() {
  runtimeStorage().setItem(aiQueueStorageKey, JSON.stringify(state.aiQueue));
}

function persistVisibleQueue() {
  saveAiQueue();
}

function mergeRequestsById(localRequests, sharedRequests) {
  const merged = new Map();

  for (const request of [...sharedRequests, ...localRequests]) {
    if (!request?.request_id) {
      continue;
    }

    const existing = merged.get(request.request_id) || {};
    merged.set(request.request_id, {
      ...existing,
      ...request,
      customer: {
        ...(existing.customer || {}),
        ...(request.customer || {}),
      },
      address: {
        ...(existing.address || {}),
        ...(request.address || {}),
      },
      execution_result: request.execution_result || existing.execution_result,
    });
  }

  return [...merged.values()].sort((left, right) =>
    String(left.requested_at || "").localeCompare(String(right.requested_at || "")),
  );
}

function shouldKeepLocalPendingRequest(request, sharedRequestIds) {
  if (!request?.request_id || sharedRequestIds.has(request.request_id)) {
    return false;
  }

  const status = normalizeText(request.status);
  if (!["pending_ai", "ready", ""].includes(status)) {
    return false;
  }

  if (normalizeText(request.execution_result?.status) === "created") {
    return false;
  }

  const echoUntil = Date.parse(request.local_echo_until || "");
  return Number.isFinite(echoUntil) && echoUntil > Date.now();
}

function shouldRetainInVisibleQueue(request) {
  return !hiddenCompletionStatuses.has(effectiveRequestStatus(request));
}

function reconcileLiveQueue(localRequests, sharedRequests) {
  if (isLocalhostRuntime()) {
    return mergeRequestsById(localRequests, sharedRequests);
  }

  const sharedRequestIds = new Set(
    (Array.isArray(sharedRequests) ? sharedRequests : [])
      .map((request) => request?.request_id)
      .filter(Boolean),
  );
  const carriedLocalRequests = (Array.isArray(localRequests) ? localRequests : []).filter((request) =>
    shouldKeepLocalPendingRequest(request, sharedRequestIds),
  );
  const liveQueue = mergeRequestsById(carriedLocalRequests, sharedRequests)
    .filter((request) => shouldRetainInVisibleQueue(request) || shouldKeepLocalPendingRequest(request, sharedRequestIds));
  state.aiQueue = liveQueue;
  persistVisibleQueue();
  return liveQueue;
}

function loadInboxConfig() {
  try {
    const raw = runtimeStorage().getItem(aiInboxConfigStorageKey);
    return raw ? JSON.parse(raw) : { inbox_url: "", inbox_key: "" };
  } catch (error) {
    return { inbox_url: "", inbox_key: "" };
  }
}

function saveInboxConfig() {
  runtimeStorage().setItem(
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
  const hasQueuedRequests = visibleQueueRequests().length > 0;
  const showAdvanced = isDebugMode();
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

function versionedAssetPath(assetPath) {
  return `${assetPath}?v=${publicDataVersion}`;
}

async function loadProductCatalog() {
  try {
    const response = await fetch(versionedAssetPath(productCatalogPath));
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
    const response = await fetch(versionedAssetPath(addressCatalogPath));
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
    const response = await fetch(versionedAssetPath(customerIndexPath));
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
    return {
      requests: Array.isArray(payload.requests) ? payload.requests : [],
      exportedAt: payload.exported_at || "",
    };
  } catch (error) {
    return {
      requests: [],
      exportedAt: "",
    };
  }
}

async function loadSharedQueueRequests() {
  const config = currentInboxConfig();
  const remoteReadUrl =
    !isLocalhostRuntime() && config.inbox_url && config.inbox_key
      ? remoteInboxReadUrl(config)
      : "";

  if (!remoteReadUrl) {
    return {
      requests: [],
      exportedAt: "",
    };
  }

  try {
    const response = await fetch(remoteReadUrl, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    return {
      requests: Array.isArray(payload.requests) ? payload.requests : [],
      exportedAt: payload.exported_at || "",
    };
  } catch (error) {
    return {
      requests: [],
      exportedAt: "",
    };
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
  state.refreshInFlight = true;
  renderSyncStatus();

  const aiStatusesPayload = await loadAiStatuses();
  state.aiStatuses = new Map(
    aiStatusesPayload.requests.map((request) => [request.request_id, request]),
  );
  const sharedQueuePayload = await loadSharedQueueRequests();
  state.sharedQueue = sharedQueuePayload.requests;
  state.aiQueue = reconcileLiveQueue(loadAiQueue(), sharedQueuePayload.requests);
  state.lastSyncedAt = latestTimestamp(
    aiStatusesPayload.exportedAt,
    sharedQueuePayload.exportedAt,
    state.lastSyncedAt,
  );
  state.refreshInFlight = false;
  renderQueue();
  renderSyncStatus();
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
  const rawMessage =
    synced?.message ||
    request?.message ||
    request?.last_error ||
    request?.execution_result?.operator_note ||
    "";
  const status = effectiveRequestStatus(request);

  if (status !== "failed") {
    return rawMessage;
  }

  const normalized = normalizeAscii(rawMessage);
  if (normalized.includes("401") || normalized.includes("unauthorized")) {
    return "Can dang nhap lai Sapo tren may worker.";
  }
  if (normalized.includes("ghn estimate returned no service")) {
    return "GHN chua tra ve dich vu phu hop.";
  }
  if (normalized.includes("could not resolve sapo city")) {
    return "Khong doi chieu duoc tinh/thanh tren Sapo.";
  }
  if (normalized.includes("could not resolve sapo district")) {
    return "Khong doi chieu duoc quan/huyen tren Sapo.";
  }
  if (normalized.includes("could not resolve sapo ward")) {
    return "Khong doi chieu duoc phuong/xa tren Sapo.";
  }

  return "Tao don that bai, can kiem tra lai.";
}

function displayRequestStatus(status) {
  const normalized = normalizeText(status);
  if (normalized === "waiting_approval") {
    return "cho_duyet";
  }
  return normalized || "pending_ai";
}

function visibleQueueRequests() {
  return [...state.aiQueue]
    .reverse()
    .filter((request) => shouldRetainInVisibleQueue(request));
}

function currentRequestPayload() {
  const payload = buildPayload();
  return {
    request_id: `${payload.customer.phone || "guest"}-${Date.now()}`,
    status: "pending_ai",
    requested_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    local_echo_until: new Date(Date.now() + localPendingEchoWindowMs).toISOString(),
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
    } else if (effectiveStatus === "waiting_approval") {
      card.classList.add("queue-card-waiting-approval");
    } else if (effectiveStatus === "failed") {
      card.classList.add("queue-card-failed");
    }
    card.innerHTML = `
      <div class="queue-card-top">
        <strong>${request.customer.name || "Chua co ten khach"}</strong>
        <span class="queue-status">${displayRequestStatus(effectiveStatus)}</span>
      </div>
      <div class="meta">SDT: ${request.customer.phone || "Chua co SDT"}</div>
      <div class="helper">${request.items.length} san pham - Tong ${request.order_total_including_shipping.toLocaleString("vi-VN")} VND</div>
      <div class="helper">${request.address.address_detail}, ${request.address.ward}, ${request.address.district}, ${request.address.province}</div>
      <div class="helper">Tao luc: ${new Date(request.requested_at).toLocaleString("vi-VN")}</div>
      ${effectiveMessage ? `<div class="helper ${effectiveStatus === "failed" ? "helper-error" : ""}">${effectiveMessage}</div>` : ""}
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
  const useRemoteGetWrite = !isLocalhostRuntime();

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
    let response;

    if (useRemoteGetWrite) {
      const [request] = requests;
      const separator = config.inbox_url.includes("?") ? "&" : "?";
      const requestJson = encodeURIComponent(JSON.stringify(request));
      const source = encodeURIComponent("dashboard-phone-order");
      const inboxKey = encodeURIComponent(config.inbox_key);
      const writeUrl =
        `${config.inbox_url}${separator}inbox_key=${inboxKey}` +
        `&source=${source}` +
        `&write_request_json=${requestJson}`;

      response = await fetch(writeUrl, {
        cache: "no-store",
      });
    } else {
      response = await fetch(useLocalInbox ? localInboxEndpoint() : config.inbox_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    }

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
  const [productCatalog, addressCatalog, customerIndex, aiStatusesPayload, publicInboxConfig] = await Promise.all([
    loadProductCatalog(),
    loadAddressCatalog(),
    loadCustomerIndex(),
    loadAiStatuses(),
    loadPublicInboxConfig(),
  ]);

  state.productCatalog = productCatalog;
  state.addressCatalog = addressCatalog;
  state.customers = customerIndex;
  if (!isLocalhostRuntime()) {
    try {
      localStorage.removeItem(aiQueueStorageKey);
      localStorage.removeItem(aiInboxConfigStorageKey);
    } catch (error) {
      console.error("Cannot clear stale public localStorage", error);
    }
  }
  const localQueue = loadAiQueue();
  state.aiStatuses = new Map(
    aiStatusesPayload.requests.map((request) => [request.request_id, request]),
  );

  const savedInboxConfig = loadInboxConfig();
  const inboxConfig =
    !isLocalhostRuntime() && publicInboxConfig.inbox_url && publicInboxConfig.inbox_key
      ? publicInboxConfig
      : savedInboxConfig.inbox_url && savedInboxConfig.inbox_key
        ? savedInboxConfig
        : publicInboxConfig;
  inboxUrlInput.value = inboxConfig.inbox_url || "";
  inboxKeyInput.value = inboxConfig.inbox_key || "";
  if (inboxConfig.inbox_url && inboxConfig.inbox_key) {
    saveInboxConfig();
  }

  const sharedQueuePayload = await loadSharedQueueRequests();
  state.sharedQueue = sharedQueuePayload.requests;
  state.aiQueue = reconcileLiveQueue(localQueue, state.sharedQueue);
  state.lastSyncedAt = latestTimestamp(
    aiStatusesPayload.exportedAt,
    sharedQueuePayload.exportedAt,
  );

  populateProvinceOptions();
  renderProductResults("");
  renderSelectedItems();
  renderQueue();
  renderPayloadPreview();
  renderSyncStatus();
  syncAdvancedPanels();

  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (error) {
      console.error("Cannot clear service workers", error);
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

async function refreshOnAppResume() {
  try {
    await refreshAiStatuses();
  } catch (error) {
    console.error("Cannot refresh on app resume", error);
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
refreshStatusButton?.addEventListener("click", () => {
  refreshOnAppResume();
});

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

window.addEventListener("focus", () => {
  refreshOnAppResume();
});

window.addEventListener("pageshow", () => {
  refreshOnAppResume();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshOnAppResume();
  }
});
