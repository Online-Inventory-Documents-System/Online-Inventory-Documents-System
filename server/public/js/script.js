// ======================================================
// GLOBAL CONFIG
// ======================================================
const API_BASE = "https://online-inventory-documents-system.onrender.com/api";

// Store user session
let currentUser = JSON.parse(sessionStorage.getItem("user")) || null;

// Helper: GET JSON
async function apiGET(url) {
  const res = await fetch(url);
  return res.json();
}

// Helper: POST JSON
async function apiPOST(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Helper: PUT JSON
async function apiPUT(url, body) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Helper: DELETE
async function apiDELETE(url) {
  const res = await fetch(url, { method: "DELETE" });
  return res.json();
}

// ======================================================
// AUTHENTICATION + ON-PAGE LOAD HANDLING
// ======================================================
document.addEventListener("DOMContentLoaded", () => {
  const page = document.documentElement.dataset.page;

  // Block pages if not logged in
  if (!currentUser && page !== "login") {
    window.location.href = "login.html";
    return;
  }

  // Auto-fill username
  if (currentUser) {
    const adminName = document.getElementById("adminName");
    if (adminName) adminName.textContent = currentUser.username;
  }

  // Page Router
  switch (page) {
    case "index":
      break;

    case "inventory":
      initInventoryPage();
      break;

    case "documents":
      initDocumentsPage();
      break;

    case "orders":
      initOrdersPage();
      break;

    case "sales":
      initSalesPage();
      break;

    case "product":
      initProductEditPage();
      break;

    case "log":
      loadActivityLog();
      break;

    case "company":
      loadCompanyInfo();
      bindCompanyEvents();
      break;

    case "setting":
      break;

    default:
      break;
  }
});

// Logout
function logout() {
  sessionStorage.clear();
  window.location.href = "login.html";
}

// Dark mode
function toggleTheme() {
  document.body.classList.toggle("dark");
}

// Log Activity to Server
async function logActivity(action) {
  await apiPOST(`${API_BASE}/log`, {
    user: currentUser?.username || "Unknown",
    action,
    time: new Date().toISOString(),
  });
}
// ======================================================
// INVENTORY MODULE
// ======================================================
let inventory = [];

// Load inventory from server
async function loadInventory() {
  try {
    const data = await apiGET(`${API_BASE}/inventory`);
    inventory = Array.isArray(data) ? data : [];
    renderInventoryTable();
  } catch (err) {
    console.error("loadInventory error", err);
  }
}

function renderInventoryTable() {
  const tbody = document.getElementById("inventoryList") || document.getElementById("inventoryBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  let totalValue = 0;
  let totalRevenue = 0;
  let totalStock = 0;

  inventory.forEach((item) => {
    const qty = Number(item.quantity || 0);
    const unitCost = Number(item.unitCost || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const value = qty * unitCost;
    const revenue = qty * unitPrice;
    totalValue += value;
    totalRevenue += revenue;
    totalStock += qty;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.sku || "")}</td>
      <td>${escapeHtml(item.name || "")}</td>
      <td>${escapeHtml(item.category || "")}</td>
      <td>${qty}</td>
      <td>${unitCost.toFixed(2)}</td>
      <td>${unitPrice.toFixed(2)}</td>
      <td>${value.toFixed(2)}</td>
      <td>
        <button class="btn-edit" data-id="${item._id || item.id}">Edit</button>
        <button class="btn-delete" data-id="${item._id || item.id}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });

  const totalValueEl = document.getElementById("totalValue");
  if (totalValueEl) totalValueEl.textContent = totalValue.toFixed(2);
  const totalRevenueEl = document.getElementById("totalRevenue");
  if (totalRevenueEl) totalRevenueEl.textContent = totalRevenue.toFixed(2);
  const totalStockEl = document.getElementById("totalStock");
  if (totalStockEl) totalStockEl.textContent = totalStock;

  // Attach events
  document.querySelectorAll(".btn-edit").forEach((b) => {
    b.addEventListener("click", (e) => {
      const id = e.currentTarget.dataset.id;
      openEditProductModal(id);
    });
  });
  document.querySelectorAll(".btn-delete").forEach((b) => {
    b.addEventListener("click", async (e) => {
      const id = e.currentTarget.dataset.id;
      if (!confirm("Delete this product?")) return;
      try {
        await apiDELETE(`${API_BASE}/inventory/${id}`);
        await loadInventory();
        alert("Deleted");
      } catch (err) {
        console.error("delete product", err);
        alert("Failed to delete product");
      }
    });
  });
}

// Add product (from inventory page inputs)
async function addProductFromForm() {
  const sku = (document.getElementById("p_sku") || {}).value || "";
  const name = (document.getElementById("p_name") || {}).value || "";
  const category = (document.getElementById("p_category") || {}).value || "";
  const quantity = Number((document.getElementById("p_quantity") || {}).value || 0);
  const unitCost = Number((document.getElementById("p_unitCost") || {}).value || 0);
  const unitPrice = Number((document.getElementById("p_unitPrice") || {}).value || 0);

  if (!sku || !name) return alert("SKU and Name are required");
  const payload = { sku, name, category, quantity, unitCost, unitPrice };
  try {
    await apiPOST(`${API_BASE}/inventory`, payload);
    await loadInventory();
    ["p_sku", "p_name", "p_category", "p_quantity", "p_unitCost", "p_unitPrice"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    alert("Product added");
  } catch (err) {
    console.error("addProductFromForm", err);
    alert("Failed to add product");
  }
}

// Open edit modal (inventory)
function openEditProductModal(id) {
  const item = inventory.find(i => (i._id || i.id) == id);
  if (!item) return alert("Item not found");
  // If product page exists, redirect with id param
  if (location.pathname.endsWith("product.html")) {
    location.href = `product.html?id=${encodeURIComponent(id)}`;
    return;
  }
  // else fill modal in inventory.html
  const modal = document.getElementById("productModal");
  if (!modal) {
    // fallback to product page
    location.href = `product.html?id=${encodeURIComponent(id)}`;
    return;
  }
  document.getElementById("modalTitle").textContent = "Edit Product";
  (document.getElementById("skuInput") || {}).value = item.sku || "";
  (document.getElementById("nameInput") || {}).value = item.name || "";
  (document.getElementById("categoryInput") || {}).value = item.category || "";
  (document.getElementById("qtyInput") || {}).value = item.quantity || 0;
  (document.getElementById("costInput") || {}).value = item.unitCost || 0;
  (document.getElementById("priceInput") || {}).value = item.unitPrice || 0;
  document.getElementById("saveProductBtn").dataset.editId = id;
  modal.classList.remove("hidden");
}

async function saveProductModal() {
  const editId = document.getElementById("saveProductBtn").dataset.editId;
  const sku = (document.getElementById("skuInput") || {}).value || "";
  const name = (document.getElementById("nameInput") || {}).value || "";
  const category = (document.getElementById("categoryInput") || {}).value || "";
  const quantity = Number((document.getElementById("qtyInput") || {}).value || 0);
  const unitCost = Number((document.getElementById("costInput") || {}).value || 0);
  const unitPrice = Number((document.getElementById("priceInput") || {}).value || 0);

  if (!sku || !name) return alert("SKU and Name required");
  const payload = { sku, name, category, quantity, unitCost, unitPrice };

  try {
    if (editId) {
      await apiPUT(`${API_BASE}/inventory/${editId}`, payload);
      delete document.getElementById("saveProductBtn").dataset.editId;
    } else {
      await apiPOST(`${API_BASE}/inventory`, payload);
    }
    document.getElementById("productModal").classList.add("hidden");
    await loadInventory();
  } catch (err) {
    console.error("saveProductModal", err);
    alert("Failed to save product");
  }
}

// Utility: escape HTML
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]); });
}
// ======================================================
// ORDERS MODULE
// ======================================================
let orders = [];
let currentOrderEditId = null;
let orderItems = [];

async function initOrdersPage() {
  await loadInventory(); // load products for dropdown
  await loadOrders();

  const btnAdd = document.getElementById("btnAddOrder");
  if (btnAdd) btnAdd.addEventListener("click", () => openOrderModal(null));

  const btnCancel = document.getElementById("cancelOrderBtn");
  if (btnCancel) btnCancel.addEventListener("click", closeOrderModal);

  const btnSave = document.getElementById("saveOrderBtn");
  if (btnSave) btnSave.addEventListener("click", saveOrder);

  const btnAddLine = document.getElementById("addOrderLine");
  if (btnAddLine) btnAddLine.addEventListener("click", addOrderLine);

  populateOrderProductDropdown();
}

async function loadOrders() {
  try {
    orders = await apiGET(`${API_BASE}/orders`);
    renderOrders();
  } catch (err) {
    console.error("loadOrders error", err);
  }
}

function renderOrders() {
  const tbody = document.querySelector("#ordersTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  orders.forEach((o) => {
    const tr = document.createElement("tr");
    const total = o.total || 0;

    tr.innerHTML = `
      <td>${o.orderNumber || o._id}</td>
      <td>${new Date(o.date).toLocaleString()}</td>
      <td>${escapeHtml(o.customer || "")}</td>
      <td>${o.items.length}</td>
      <td>RM ${total.toFixed(2)}</td>
      <td>
        <button class="btn-edit" data-id="${o._id}">Edit</button>
        <button class="btn-delete" data-id="${o._id}">Delete</button>
        <button class="btn-pdf" data-id="${o._id}">PDF</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll(".btn-edit").forEach((b) => {
    b.addEventListener("click", (e) => openOrderModal(e.currentTarget.dataset.id));
  });

  document.querySelectorAll(".btn-delete").forEach((b) => {
    b.addEventListener("click", async (e) => {
      if (!confirm("Delete this order?")) return;
      await apiDELETE(`${API_BASE}/orders/${e.currentTarget.dataset.id}`);
      await loadOrders();
    });
  });

  document.querySelectorAll(".btn-pdf").forEach((b) => {
    b.addEventListener("click", (e) => {
      window.open(`${API_BASE}/report/order/${e.currentTarget.dataset.id}/pdf`);
    });
  });
}

function openOrderModal(id) {
  const modal = document.getElementById("orderModal");
  if (!modal) return;

  currentOrderEditId = id;
  orderItems = [];

  document.getElementById("orderCustomer").value = "";
  document.getElementById("orderContact").value = "";
  document.querySelector("#orderLines tbody").innerHTML = "";

  if (id) {
    const o = orders.find((x) => x._id === id);
    if (o) {
      document.getElementById("orderCustomer").value = o.customer;
      document.getElementById("orderContact").value = o.contact;
      orderItems = JSON.parse(JSON.stringify(o.items));
      renderOrderLines();
    }
  }

  calcOrderTotals();
  modal.classList.remove("hidden");
}

function closeOrderModal() {
  document.getElementById("orderModal").classList.add("hidden");
}

function populateOrderProductDropdown() {
  const select = document.getElementById("orderProductSelect");
  if (!select) return;

  select.innerHTML = inventory.map((i) =>
    `<option value="${i._id}" data-price="${i.unitPrice}">${i.sku} - ${i.name}</option>`
  ).join("");
}

function addOrderLine() {
  const select = document.getElementById("orderProductSelect");
  const qtyEl = document.getElementById("orderItemQty");
  const priceEl = document.getElementById("orderItemPrice");

  const productId = select.value;
  const qty = Number(qtyEl.value);
  const price = Number(priceEl.value);

  if (!productId || qty <= 0 || price <= 0) return alert("Invalid item");

  const product = inventory.find((p) => p._id === productId);
  if (!product) return alert("Invalid product");

  orderItems.push({
    productId,
    sku: product.sku,
    name: product.name,
    qty,
    price,
    total: qty * price,
  });

  renderOrderLines();
  calcOrderTotals();
}

function renderOrderLines() {
  const tbody = document.querySelector("#orderLines tbody");
  tbody.innerHTML = "";

  orderItems.forEach((line, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${line.name}</td>
      <td>${line.qty}</td>
      <td>RM ${line.price.toFixed(2)}</td>
      <td>RM ${(line.qty * line.price).toFixed(2)}</td>
      <td><button data-idx="${idx}" class="btn-delete-line">X</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll(".btn-delete-line").forEach((b) => {
    b.addEventListener("click", (e) => {
      const idx = e.currentTarget.dataset.idx;
      orderItems.splice(idx, 1);
      renderOrderLines();
      calcOrderTotals();
    });
  });
}

function calcOrderTotals() {
  let subtotal = 0;
  orderItems.forEach((l) => (subtotal += l.qty * l.price));

  const tax = subtotal * 0.00; // tax optional
  const total = subtotal + tax;

  document.getElementById("orderSubtotal").textContent = subtotal.toFixed(2);
  document.getElementById("orderTax").textContent = tax.toFixed(2);
  document.getElementById("orderTotal").textContent = total.toFixed(2);
}

async function saveOrder() {
  if (orderItems.length === 0) return alert("Order has no items");

  const customer = document.getElementById("orderCustomer").value;
  const contact = document.getElementById("orderContact").value;

  const payload = {
    customer,
    contact,
    items: orderItems,
    subtotal: orderItems.reduce((a, c) => a + c.qty * c.price, 0),
    tax: 0,
    total: orderItems.reduce((a, c) => a + c.qty * c.price, 0),
  };

  if (currentOrderEditId) {
    await apiPUT(`${API_BASE}/orders/${currentOrderEditId}`, payload);
  } else {
    await apiPOST(`${API_BASE}/orders`, payload);
  }

  closeOrderModal();
  await loadOrders();
  alert("Order saved");
}



// ======================================================
// SALES MODULE
// ======================================================
let sales = [];
let currentSaleEditId = null;
let saleItems = [];

async function initSalesPage() {
  await loadInventory();
  await loadSales();

  const btnAdd = document.getElementById("btnAddSale");
  if (btnAdd) btnAdd.addEventListener("click", () => openSaleModal(null));

  document.getElementById("cancelSaleBtn").addEventListener("click", closeSaleModal);
  document.getElementById("saveSaleBtn").addEventListener("click", saveSale);
  document.getElementById("addSaleLine").addEventListener("click", addSaleLine);

  populateSaleProductDropdown();
}

async function loadSales() {
  try {
    sales = await apiGET(`${API_BASE}/sales`);
    renderSales();
  } catch (err) {
    console.error("loadSales", err);
  }
}

function renderSales() {
  const tbody = document.querySelector("#salesTable tbody");
  tbody.innerHTML = "";

  sales.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.saleNumber || s._id}</td>
      <td>${new Date(s.date).toLocaleString()}</td>
      <td>${escapeHtml(s.customer)}</td>
      <td>${s.items.length}</td>
      <td>RM ${(s.total || 0).toFixed(2)}</td>
      <td>
        <button class="btn-edit" data-id="${s._id}">Edit</button>
        <button class="btn-delete" data-id="${s._id}">Delete</button>
        <button class="btn-pdf" data-id="${s._id}">PDF</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll(".btn-edit").forEach((b) => {
    b.addEventListener("click", (e) => openSaleModal(e.currentTarget.dataset.id));
  });

  document.querySelectorAll(".btn-delete").forEach((b) => {
    b.addEventListener("click", async (e) => {
      if (!confirm("Delete sale?")) return;
      await apiDELETE(`${API_BASE}/sales/${e.currentTarget.dataset.id}`);
      await loadSales();
    });
  });

  document.querySelectorAll(".btn-pdf").forEach((b) => {
    b.addEventListener("click", (e) => {
      window.open(`${API_BASE}/report/sale/${e.currentTarget.dataset.id}/pdf`);
    });
  });
}

function openSaleModal(id) {
  const modal = document.getElementById("saleModal");
  currentSaleEditId = id;
  saleItems = [];

  document.getElementById("saleCustomer").value = "";
  document.getElementById("saleContact").value = "";
  document.querySelector("#saleLines tbody").innerHTML = "";

  if (id) {
    const s = sales.find((x) => x._id === id);
    if (s) {
      document.getElementById("saleCustomer").value = s.customer;
      document.getElementById("saleContact").value = s.contact;
      saleItems = JSON.parse(JSON.stringify(s.items));
      renderSaleLines();
    }
  }

  calcSaleTotals();
  modal.classList.remove("hidden");
}

function closeSaleModal() {
  document.getElementById("saleModal").classList.add("hidden");
}

function populateSaleProductDropdown() {
  const select = document.getElementById("saleProductSelect");
  select.innerHTML = inventory
    .map((i) => `<option value="${i._id}" data-price="${i.unitPrice}">${i.sku} - ${i.name}</option>`)
    .join("");
}

function addSaleLine() {
  const select = document.getElementById("saleProductSelect");
  const qtyEl = document.getElementById("saleItemQty");
  const priceEl = document.getElementById("saleItemPrice");

  const productId = select.value;
  const qty = Number(qtyEl.value);
  const price = Number(priceEl.value);

  if (!productId || qty <= 0 || price <= 0) return alert("Invalid item");

  const product = inventory.find((p) => p._id === productId);
  if (!product) return alert("Invalid product");

  saleItems.push({
    productId,
    sku: product.sku,
    name: product.name,
    qty,
    price,
    total: qty * price,
  });

  renderSaleLines();
  calcSaleTotals();
}

function renderSaleLines() {
  const tbody = document.querySelector("#saleLines tbody");
  tbody.innerHTML = "";

  saleItems.forEach((line, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${line.name}</td>
      <td>${line.qty}</td>
      <td>RM ${line.price.toFixed(2)}</td>
      <td>RM ${(line.qty * line.price).toFixed(2)}</td>
      <td><button data-idx="${idx}" class="btn-delete-line">X</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll(".btn-delete-line").forEach((b) => {
    b.addEventListener("click", (e) => {
      saleItems.splice(e.currentTarget.dataset.idx, 1);
      renderSaleLines();
      calcSaleTotals();
    });
  });
}

function calcSaleTotals() {
  let subtotal = 0;
  saleItems.forEach((l) => (subtotal += l.qty * l.price));

  const tax = subtotal * 0;
  const total = subtotal + tax;

  document.getElementById("saleSubtotal").textContent = subtotal.toFixed(2);
  document.getElementById("saleTax").textContent = tax.toFixed(2);
  document.getElementById("saleTotal").textContent = total.toFixed(2);
}

async function saveSale() {
  if (saleItems.length === 0) return alert("Sale has no items");

  const customer = document.getElementById("saleCustomer").value;
  const contact = document.getElementById("saleContact").value;

  const payload = {
    customer,
    contact,
    items: saleItems,
    subtotal: saleItems.reduce((a, c) => a + c.qty * c.price, 0),
    tax: 0,
    total: saleItems.reduce((a, c) => a + c.qty * c.price, 0),
  };

  if (currentSaleEditId) {
    await apiPUT(`${API_BASE}/sales/${currentSaleEditId}`, payload);
  } else {
    await apiPOST(`${API_BASE}/sales`, payload);
  }

  closeSaleModal();
  await loadSales();
  alert("Sale saved");
}
// ======================================================
// DOCUMENTS MODULE
// ======================================================
async function initDocumentsPage() {
  await loadDocuments();
  const uploadBtn = document.getElementById("uploadDocsBtn");
  if (uploadBtn) uploadBtn.addEventListener("click", uploadDocumentsHandler);
  const fileInput = document.getElementById("docUpload");
  if (fileInput) fileInput.addEventListener("change", () => { /* file selection only metadata saved */ });
}

async function loadDocuments() {
  try {
    const docs = await apiGET(`${API_BASE}/documents`);
    const tbody = document.getElementById("docList");
    if (!tbody) return;
    tbody.innerHTML = "";
    (Array.isArray(docs) ? docs : []).forEach(d => {
      const tr = document.createElement("tr");
      const sizeMB = ((d.size || 0) / (1024*1024)).toFixed(2);
      tr.innerHTML = `<td>${escapeHtml(d.name||'')}</td><td>${sizeMB} MB</td><td>${new Date(d.date||Date.now()).toLocaleString()}</td>
        <td>
          <button class="doc-download" data-name="${encodeURIComponent(d.name||'')}">Download</button>
          <button class="doc-delete" data-id="${d._id||d.id}">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.doc-download').forEach(b => b.addEventListener('click', (e) => {
      const name = decodeURIComponent(e.currentTarget.dataset.name || '');
      window.open(`${API_BASE}/documents/download/${encodeURIComponent(name)}`, '_blank');
    }));
    document.querySelectorAll('.doc-delete').forEach(b => b.addEventListener('click', async (e) => {
      if(!confirm('Delete document metadata?')) return;
      const id = e.currentTarget.dataset.id;
      await apiDELETE(`${API_BASE}/documents/${id}`);
      await loadDocuments();
    }));
  } catch (err) {
    console.error('loadDocuments', err);
  }
}

async function uploadDocumentsHandler() {
  const input = document.getElementById('docUpload');
  if (!input || !input.files || input.files.length === 0) return alert('Select files to upload (metadata)');
  if (!confirm(`Save metadata for ${input.files.length} file(s)?`)) return;
  for (let i=0;i<input.files.length;i++){
    const f = input.files[i];
    await apiPOST(`${API_BASE}/documents`, { name: f.name, size: f.size, type: f.type });
  }
  await loadDocuments();
  alert('Uploaded metadata.');
}

// ======================================================
// COMPANY MODULE
// ======================================================
async function loadCompanyInfo(){
  try {
    const data = await apiGET(`${API_BASE}/company`);
    if (!data) return;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    setVal('companyName', data.name || '');
    setVal('companyAddress', data.address || '');
    setVal('companyPhone', data.phone || '');
    setVal('companyEmail', data.email || '');
    setVal('companyTax', data.taxNumber || data.tax || '');
  } catch (err) { console.error('loadCompanyInfo', err); }
}

function bindCompanyEvents(){
  const saveBtn = document.getElementById('saveCompany');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const payload = {
      name: (document.getElementById('companyName')||{}).value || '',
      address: (document.getElementById('companyAddress')||{}).value || '',
      phone: (document.getElementById('companyPhone')||{}).value || '',
      email: (document.getElementById('companyEmail')||{}).value || '',
      taxNumber: (document.getElementById('companyTax')||{}).value || ''
    };
    try {
      await apiPOST(`${API_BASE}/company`, payload);
      alert('Company info saved');
    } catch (err) { console.error(err); alert('Failed to save company info'); }
  });
}

// ======================================================
// LOGS
// ======================================================
async function loadActivityLog(){
  try {
    const entries = await apiGET(`${API_BASE}/logs`);
    const tbody = document.getElementById('logList');
    if (!tbody) return;
    tbody.innerHTML = '';
    (Array.isArray(entries) ? entries : []).forEach(l => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(l.user||'')}</td><td>${escapeHtml(l.action||'')}</td><td>${new Date(l.time||Date.now()).toLocaleString()}</td>`;
      tbody.appendChild(tr);
    });
  } catch (err) { console.error('loadActivityLog', err); }
}

// ======================================================
// PRODUCT EDIT PAGE
// ======================================================
function initProductEditPage(){
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (id) {
    apiGET(`${API_BASE}/inventory`).then(items => {
      const it = (items||[]).find(x => (x._id||x.id) === id);
      if (!it) return alert('Product not found');
      (document.getElementById('prod_id')||{}).value = it._id || it.id;
      (document.getElementById('prod_sku')||{}).value = it.sku || '';
      (document.getElementById('prod_name')||{}).value = it.name || '';
      (document.getElementById('prod_category')||{}).value = it.category || '';
      (document.getElementById('prod_quantity')||{}).value = it.quantity || 0;
      (document.getElementById('prod_unitCost')||{}).value = it.unitCost || 0;
      (document.getElementById('prod_unitPrice')||{}).value = it.unitPrice || 0;
    });
  }

  const saveBtn = document.getElementById('saveProductBtn');
  if (saveBtn) saveBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const idVal = (document.getElementById('prod_id')||{}).value;
    const payload = {
      sku: (document.getElementById('prod_sku')||{}).value,
      name: (document.getElementById('prod_name')||{}).value,
      category: (document.getElementById('prod_category')||{}).value,
      quantity: Number((document.getElementById('prod_quantity')||{}).value||0),
      unitCost: Number((document.getElementById('prod_unitCost')||{}).value||0),
      unitPrice: Number((document.getElementById('prod_unitPrice')||{}).value||0)
    };
    try {
      await apiPUT(`${API_BASE}/inventory/${idVal}`, payload);
      alert('Updated');
      location.href = 'inventory.html';
    } catch (err) { console.error(err); alert('Failed to update product'); }
  });

  const cancelBtn = document.getElementById('cancelProductBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', (e)=>{ e.preventDefault(); location.href='inventory.html'; });
}

// ======================================================
// INVENTORY PAGE INIT (binds inputs & buttons)
// ======================================================
function initInventoryPage(){
  loadInventory();
  const addBtn = document.getElementById('addProductBtn');
  if (addBtn) addBtn.addEventListener('click', addProductFromForm);

  const addItemBtn = document.getElementById('addItemBtn') || document.getElementById('addProductBtn');
  if (addItemBtn) addItemBtn.addEventListener('click', ()=> {
    const modal = document.getElementById('productModal');
    if (modal) modal.classList.remove('hidden');
  });

  const closeProductModal = document.getElementById('closeProductModal');
  if (closeProductModal) closeProductModal.addEventListener('click', ()=> {
    const modal = document.getElementById('productModal');
    if (modal) modal.classList.add('hidden');
  });

  const saveProductBtn = document.getElementById('saveProductBtn');
  if (saveProductBtn) saveProductBtn.addEventListener('click', saveProductModal);

  const genPdfBtn = document.getElementById('generateInventoryPdfBtn');
  if (genPdfBtn) genPdfBtn.addEventListener('click', ()=> window.open(`${API_BASE}/report/inventory/pdf`, '_blank'));

  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.addEventListener('input', (e)=> {
    const q = (e.target.value||'').toLowerCase();
    const filtered = (inventory||[]).filter(i => (i.sku||'').toLowerCase().includes(q) || (i.name||'').toLowerCase().includes(q) || (i.category||'').toLowerCase().includes(q));
    // temp render
    const tbody = document.getElementById('inventoryList') || document.getElementById('inventoryBody');
    if (tbody){
      tbody.innerHTML = "";
      filtered.forEach(item => {
        const qty = Number(item.quantity||0);
        const uc = Number(item.unitCost||0);
        const up = Number(item.unitPrice||0);
        const invVal = qty * uc;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(item.sku||'')}</td><td>${escapeHtml(item.name||'')}</td><td>${escapeHtml(item.category||'')}</td><td>${qty}</td><td>${uc.toFixed(2)}</td><td>${up.toFixed(2)}</td><td>${invVal.toFixed(2)}</td>
          <td><button class="btn-edit" data-id="${item._id||item.id}">Edit</button><button class="btn-delete" data-id="${item._id||item.id}">Delete</button></td>`;
        tbody.appendChild(tr);
      });
    }
  });

  const clearBtn = document.getElementById('clearSearchBtn');
  if (clearBtn) clearBtn.addEventListener('click', ()=> { const si = document.getElementById('searchInput'); if (si) si.value=''; loadInventory(); });
}

// ======================================================
// LOGIN / REGISTER PAGE
// ======================================================
function bindLoginPage(){
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const toggleToRegister = document.getElementById('toggleToRegister');
  const toggleToLogin = document.getElementById('toggleToLogin');

  if (loginBtn) loginBtn.addEventListener('click', async () => {
    const user = (document.getElementById('username')||{}).value;
    const pass = (document.getElementById('password')||{}).value;
    if (!user || !pass) return alert('Enter username and password');
    try {
      const res = await apiPOST(`${API_BASE}/login`, { username: user, password: pass });
      if (res && res.success) {
        currentUser = { username: user };
        sessionStorage.setItem('user', JSON.stringify(currentUser));
        sessionStorage.setItem('isLoggedIn', 'true');
        window.location.href = 'index.html';
      } else {
        alert(res && res.message ? res.message : 'Login failed');
      }
    } catch (err) { console.error(err); alert('Login error'); }
  });

  if (registerBtn) registerBtn.addEventListener('click', async () => {
    const user = (document.getElementById('newUsername')||{}).value;
    const pass = (document.getElementById('newPassword')||{}).value;
    const code = (document.getElementById('securityCode')||{}).value;
    if (!user || !pass || !code) return alert('Fill all fields');
    try {
      const res = await apiPOST(`${API_BASE}/register`, { username: user, password: pass, securityCode: code });
      if (res && res.success) {
        alert('Registered - please login');
        document.getElementById('registerForm').style.display = 'none';
        document.getElementById('loginForm').style.display = 'block';
      } else {
        alert(res && res.message ? res.message : 'Register failed');
      }
    } catch (err) { console.error(err); alert('Register error'); }
  });

  if (toggleToRegister) toggleToRegister.addEventListener('click', ()=> {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
  });
  if (toggleToLogin) toggleToLogin.addEventListener('click', ()=> {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
  });
}

// ======================================================
// FINAL BINDINGS: run page-specific binders where needed
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
  const page = document.documentElement.dataset.page;
  if (page === 'inventory') initInventoryPage();
  if (page === 'documents') initDocumentsPage();
  if (page === 'orders') initOrdersPage();
  if (page === 'sales') initSalesPage();
  if (page === 'product') initProductEditPage();
  if (page === 'log') loadActivityLog();
  if (page === 'company') { loadCompanyInfo(); bindCompanyEvents(); }
  if (location.pathname.endsWith('login.html')) bindLoginPage();

  // Show admin name where available
  const adminSpan = document.getElementById('adminName');
  if (adminSpan && currentUser) adminSpan.textContent = currentUser.username;
});

// Expose small utilities for inline HTML usage
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditProduct = (id) => openEditProductModal(id);
window.confirmDeleteProduct = async (id) => {
  if (!confirm('Delete this product?')) return;
  await apiDELETE(`${API_BASE}/inventory/${id}`);
  await loadInventory();
};
