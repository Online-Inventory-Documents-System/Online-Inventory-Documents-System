// public/js/script.js
// Clean, full-featured client script for Online Inventory & Documents System
// - Fixes render order issues
// - Adds Sales & Orders management UI helpers (modals + API)
// - Adds Chart.js support (uses CDN included in your HTML pages)
// - Matches server endpoints: /api/{inventory,sales,orders}/..., /api/reports/zip, /api/documents, /api/logs

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

// -------------------- Utilities --------------------
const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = s => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';
const currentPage = window.location.pathname.split('/').pop();
const blank = v => v === undefined || v === null || v === '';

// small wrapper to include X-Username header
async function apiFetch(url, options = {}) {
  const headers = options.headers || {};
  headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  headers['X-Username'] = getUsername();
  options.headers = headers;
  return fetch(url, options);
}

// -------------------- App State --------------------
let inventory = [];
let sales = [];
let orders = [];
let documents = [];
let activityLog = [];
let inventoryChartInstance = null;

// -------------------- Renderers --------------------
// Dashboard small-stats + recent activity
function renderDashboardData() {
  // totals
  const dashItemsEl = qs('#dash_totalItems');
  if (dashItemsEl) {
    let totalValue = 0, totalRevenue = 0, totalStock = 0;
    inventory.forEach(it => {
      const qty = Number(it.quantity || 0);
      totalValue += qty * Number(it.unitCost || 0);
      totalRevenue += qty * Number(it.unitPrice || 0);
      totalStock += qty;
    });
    qs('#dash_totalItems').textContent = inventory.length;
    qs('#dash_totalValue').textContent = totalValue.toFixed(2);
    qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
    qs('#dash_totalStock').textContent = totalStock;
  }

  // recent activities table/rows
  const recentTbody = qs('#recentActivities');
  if (recentTbody) {
    recentTbody.innerHTML = '';
    activityLog.slice(0,5).forEach(l => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(l.user||'System')}</td><td>${escapeHtml(l.action)}</td><td>${new Date(l.time).toLocaleString()}</td>`;
      recentTbody.appendChild(tr);
    });
  }

  // chart update (if present)
  if (qs('#inventoryChart')) initOrUpdateInventoryChart();
}

// Inventory list renderer
function renderInventoryList(items = inventory) {
  const list = qs('#inventoryList');
  if (!list) return;
  list.innerHTML = '';

  let totalValue = 0, totalRevenue = 0, totalStock = 0;
  items.forEach(it => {
    const id = it.id || it._id;
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const invVal = qty * uc;
    const rev = qty * up;
    totalValue += invVal; totalRevenue += rev; totalStock += qty;

    const tr = document.createElement('tr');
    if (qty === 0) tr.classList.add('out-of-stock-row');
    else if (qty < 10) tr.classList.add('low-stock-row');

    tr.innerHTML = `
      <td>${escapeHtml(it.sku||'')}</td>
      <td>${escapeHtml(it.name||'')}</td>
      <td>${escapeHtml(it.category||'')}</td>
      <td>${qty}</td>
      <td class="money">RM ${uc.toFixed(2)}</td>
      <td class="money">RM ${up.toFixed(2)}</td>
      <td class="money">RM ${invVal.toFixed(2)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditPageForItem('${id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="confirmAndDeleteItem('${id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });

  if (qs('#totalValue')) qs('#totalValue').textContent = totalValue.toFixed(2);
  if (qs('#totalRevenue')) qs('#totalRevenue').textContent = totalRevenue.toFixed(2);
  if (qs('#totalStock')) qs('#totalStock').textContent = totalStock;
}

// Documents renderer
function renderDocumentsList(docs = documents) {
  const list = qs('#docList');
  if (!list) return;
  list.innerHTML = '';
  docs.forEach(d => {
    const id = d.id || d._id;
    const sizeMB = ((d.sizeBytes || d.size || 0) / (1024*1024)).toFixed(2);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(d.name||'')}</td>
      <td>${sizeMB} MB</td>
      <td>${new Date(d.date).toLocaleString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="downloadDocument('${encodeURIComponent(d.name||'')}')">⬇️ Download</button>
        <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });
}

// Sales renderer
function renderSalesList(rows = sales) {
  const t = qs('#salesList'); if(!t) return;
  t.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.invoice||'')}</td>
      <td>${escapeHtml(r.product||'')}</td>
      <td>${Number(r.quantity||0)}</td>
      <td class="money">RM ${Number(r.total||0).toFixed(2)}</td>
      <td>${new Date(r.date || r.createdAt || Date.now()).toLocaleString()}</td>
    `;
    t.appendChild(tr);
  });
}

// Orders renderer
function renderOrdersList(rows = orders) {
  const t = qs('#ordersList'); if(!t) return;
  t.innerHTML = '';
  rows.forEach(o => {
    const itemsSummary = Array.isArray(o.items) ? o.items.map(i => `${escapeHtml(i.name||i.sku||'')} x${i.qty}`).join(', ') : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(o.orderNumber || o._id || '')}</td>
      <td>${escapeHtml(o.customerName || '')}</td>
      <td>${itemsSummary}</td>
      <td class="money">RM ${Number(o.total||0).toFixed(2)}</td>
      <td>${escapeHtml(o.status || 'Pending')}</td>
      <td>${new Date(o.date || o.createdAt || Date.now()).toLocaleString()}</td>
    `;
    t.appendChild(tr);
  });
}

// -------------------- Charts --------------------
function initOrUpdateInventoryChart() {
  // Only run if Chart.js available and element present
  const canvas = qs('#inventoryChart');
  if (!canvas) return;
  if (typeof Chart === 'undefined') {
    // Chart.js not loaded; quickly try to add CDN (optionally you preload in HTML)
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    s.onload = () => initOrUpdateInventoryChart();
    document.head.appendChild(s);
    return;
  }

  // Prepare labels and values: top 10 items by stock
  const sorted = [...inventory].sort((a,b)=> (Number(b.quantity||0) - Number(a.quantity||0))).slice(0,15);
  const labels = sorted.map(i => i.name || i.sku || '(no name)');
  const data = sorted.map(i => Number(i.quantity||0));

  const ctx = canvas.getContext('2d');
  if (inventoryChartInstance) {
    inventoryChartInstance.data.labels = labels;
    inventoryChartInstance.data.datasets[0].data = data;
    inventoryChartInstance.update();
    return;
  }

  inventoryChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Stock Qty',
        data,
        backgroundColor: 'rgba(54, 162, 235, 0.7)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true }
      },
      plugins: { legend: { display: false } }
    }
  });
}

// -------------------- Fetchers --------------------
async function fetchInventory() {
  try {
    const res = await apiFetch(`${API_BASE}/inventory`);
    if (!res.ok) throw new Error('Failed to fetch inventory');
    const data = await res.json();
    inventory = data.map(i => ({ ...i, id: i.id || i._id }));
    renderInventoryList(inventory);
    renderDashboardData();
  } catch (err) {
    console.error('fetchInventory error', err);
  }
}

async function fetchDocuments() {
  try {
    const res = await apiFetch(`${API_BASE}/documents`);
    if (!res.ok) throw new Error('Failed to fetch docs');
    const data = await res.json();
    documents = data.map(d => ({ ...d, id: d.id || d._id }));
    renderDocumentsList(documents);
  } catch (err) {
    console.error('fetchDocuments error', err);
  }
}

async function fetchLogs() {
  try {
    const res = await apiFetch(`${API_BASE}/logs`);
    if (!res.ok) throw new Error('Failed to fetch logs');
    activityLog = await res.json();
    // keep newest-first (server sends in descending time)
    renderDashboardData();
    // render log page if present
    const logListEl = qs('#logList');
    if (logListEl) {
      logListEl.innerHTML = '';
      activityLog.forEach(l => {
        const li = document.createElement('li');
        li.innerHTML = `[${new Date(l.time).toLocaleString()}] <b>${escapeHtml(l.user || 'System')}</b>: ${escapeHtml(l.action || '')}`;
        logListEl.appendChild(li);
      });
    }
  } catch (err) {
    console.error('fetchLogs error', err);
  }
}

async function fetchSales() {
  try {
    const res = await apiFetch(`${API_BASE}/sales`);
    if (!res.ok) throw new Error('Failed to fetch sales');
    sales = await res.json();
    sales = sales.map(s => ({ ...s, id: s.id || s._id }));
    renderSalesList(sales);
  } catch (err) {
    console.error('fetchSales error', err);
  }
}

async function fetchOrders() {
  try {
    const res = await apiFetch(`${API_BASE}/orders`);
    if (!res.ok) throw new Error('Failed to fetch orders');
    orders = await res.json();
    orders = orders.map(o => ({ ...o, id: o.id || o._id }));
    renderOrdersList(orders);
  } catch (err) {
    console.error('fetchOrders error', err);
  }
}

// -------------------- Auth --------------------
async function login() {
  const user = qs('#username')?.value?.trim();
  const pass = qs('#password')?.value?.trim();
  const msg = qs('#loginMessage');
  showMsg(msg, '');
  if (!user || !pass) { showMsg(msg, '⚠️ Enter username & password', 'red'); return; }
  try {
    const res = await apiFetch(`${API_BASE}/login`, { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
    const data = await res.json();
    if (res.ok) {
      sessionStorage.setItem('isLoggedIn', 'true');
      sessionStorage.setItem('adminName', user);
      showMsg(msg, '✅ Login success', 'green');
      setTimeout(() => window.location.href = 'index.html', 700);
    } else {
      showMsg(msg, `❌ ${data.message || 'Login failed'}`, 'red');
    }
  } catch (err) {
    console.error('login error', err);
    showMsg(msg, '❌ Server error', 'red');
  }
}

// -------------------- Inventory CRUD --------------------
async function confirmAndAddProduct() {
  const sku = qs('#p_sku')?.value?.trim();
  const name = qs('#p_name')?.value?.trim();
  const category = qs('#p_category')?.value?.trim();
  const quantity = Number(qs('#p_quantity')?.value || 0);
  const unitCost = Number(qs('#p_unitCost')?.value || 0);
  const unitPrice = Number(qs('#p_unitPrice')?.value || 0);
  if (!sku || !name) return alert('Enter SKU & Name');
  if (!confirm(`Add product "${name}"?`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory`, { method: 'POST', body: JSON.stringify({ sku, name, category, quantity, unitCost, unitPrice }) });
    if (res.ok) {
      ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id => qs(id) && (qs(id).value = ''));
      await fetchInventory();
      await fetchLogs();
      alert('✅ Product added');
    } else {
      const err = await res.json();
      throw err;
    }
  } catch (err) {
    console.error('add product error', err);
    alert('❌ Failed to add product');
  }
}

async function confirmAndDeleteItem(id) {
  const it = inventory.find(x => String(x.id) === String(id));
  if (!it) return alert('Item not found');
  if (!confirm(`Delete "${it.name}"?`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method: 'DELETE' });
    if (res.status === 204) {
      await fetchInventory();
      await fetchLogs();
      alert('🗑️ Item deleted');
    } else {
      const err = await res.json();
      throw err;
    }
  } catch (err) {
    console.error('delete item error', err);
    alert('❌ Failed to delete');
  }
}

async function confirmAndGenerateInventoryXLSX() {
  if (!confirm('Generate inventory Excel?')) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory/report`, { method: 'GET' });
    if (!res.ok) { const err = await res.json(); return alert('Failed: ' + (err.message || '')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="(.+?)"/);
    const filename = match ? match[1] : `Inventory_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchDocuments();
    alert('✅ Inventory report downloaded');
  } catch (err) {
    console.error('inventory report error', err);
    alert('❌ Report failed');
  }
}

// PDF download helper (inventory/sales/orders)
async function downloadReportPDF(type) {
  // type: 'inventory' | 'sales' | 'orders'
  const endpoint = `${API_BASE}/${type}/report/pdf`;
  // some HTML buttons already open /api/.../pdf, but we centralize here
  window.open(endpoint, '_blank');
}

// ZIP all reports
async function downloadAllReportsZip() {
  try {
    const res = await apiFetch(`${API_BASE}/reports/zip`, { method: 'GET' });
    if (!res.ok) { const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const filename = `All_Reports_${new Date().toISOString().slice(0,10)}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch (err) {
    console.error('zip download error', err);
    alert('❌ Zip download failed');
  }
}

// -------------------- Product page (edit) --------------------
async function bindProductPage() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (id) {
    try {
      const res = await apiFetch(`${API_BASE}/inventory`);
      if (!res.ok) throw new Error('Failed load inventory');
      const items = await res.json();
      const it = items.find(x => String(x.id) === String(id) || String(x._id) === String(id));
      if (!it) return alert('Item not found');
      if (qs('#prod_id')) qs('#prod_id').value = it.id || it._id;
      if (qs('#prod_sku')) qs('#prod_sku').value = it.sku || '';
      if (qs('#prod_name')) qs('#prod_name').value = it.name || '';
      if (qs('#prod_category')) qs('#prod_category').value = it.category || '';
      if (qs('#prod_quantity')) qs('#prod_quantity').value = it.quantity || 0;
      if (qs('#prod_unitCost')) qs('#prod_unitCost').value = it.unitCost || 0;
      if (qs('#prod_unitPrice')) qs('#prod_unitPrice').value = it.unitPrice || 0;
    } catch (err) {
      console.error('bindProductPage load', err);
      alert('Failed to load product');
      return;
    }
  }

  qs('#saveProductBtn')?.addEventListener('click', async () => {
    if (!confirm('Save changes?')) return;
    const idVal = qs('#prod_id')?.value;
    const body = {
      sku: qs('#prod_sku')?.value,
      name: qs('#prod_name')?.value,
      category: qs('#prod_category')?.value,
      quantity: Number(qs('#prod_quantity')?.value || 0),
      unitCost: Number(qs('#prod_unitCost')?.value || 0),
      unitPrice: Number(qs('#prod_unitPrice')?.value || 0)
    };
    try {
      const res = await apiFetch(`${API_BASE}/inventory/${idVal}`, { method: 'PUT', body: JSON.stringify(body) });
      if (res.ok) { await fetchInventory(); await fetchLogs(); alert('✅ Updated'); window.location.href = 'inventory.html'; }
      else { const err = await res.json(); throw err; }
    } catch (err) {
      console.error('save product error', err);
      alert('❌ Update failed');
    }
  });

  qs('#cancelProductBtn')?.addEventListener('click', () => window.location.href = 'inventory.html');
}

// -------------------- Documents --------------------
async function uploadDocuments() {
  const files = qs('#docUpload')?.files || [];
  const msgEl = qs('#uploadMessage');
  if (files.length === 0) return showMsg(msgEl, '⚠️ Select files', 'red');
  if (!confirm(`Upload metadata for ${files.length} doc(s)?`)) return showMsg(msgEl, 'Cancelled', 'orange');
  showMsg(msgEl, `Uploading metadata...`, 'orange');
  for (const f of files) {
    try {
      const res = await apiFetch(`${API_BASE}/documents`, { method: 'POST', body: JSON.stringify({ name: f.name, type: f.type, sizeBytes: f.size }) });
      if (!res.ok) throw new Error('Server failed');
    } catch (err) {
      console.error('uploadDocument error', err);
      showMsg(msgEl, `❌ Failed ${f.name}`, 'red');
      return;
    }
  }
  qs('#docUpload').value = '';
  setTimeout(async () => { await fetchDocuments(); showMsg(msgEl, '✅ Uploaded', 'green'); setTimeout(()=>msgEl.textContent='','2000'); }, 700);
}

function downloadDocument(fileNameEncoded) {
  const fileName = decodeURIComponent(fileNameEncoded);
  if (!confirm(`Download: ${fileName}?`)) return;
  // server provides redirect for inventory report, and otherwise 404
  window.open(`${API_BASE}/documents/download/${encodeURIComponent(fileName)}`, '_blank');
}

async function deleteDocumentConfirm(id) {
  const d = documents.find(x => String(x.id) === String(id));
  if (!d) return;
  if (!confirm(`Delete metadata for "${d.name}"?`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/documents/${id}`, { method: 'DELETE' });
    if (res.status === 204) { await fetchDocuments(); await fetchLogs(); alert('Deleted'); }
    else throw new Error('Delete failed');
  } catch (err) {
    console.error('deleteDocument', err);
    alert('❌ Failed to delete');
  }
}

// -------------------- Sales (UI + API) --------------------
function bindSalesUI() {
  qs('#downloadSalesXLSXBtn')?.addEventListener('click', downloadSalesReportXLSX);
  qs('#downloadSalesXLSXBtnInline')?.addEventListener('click', downloadSalesReportXLSX);
  qs('#downloadSalesPDFBtn')?.addEventListener('click', () => downloadReportPDF('sales'));
  qs('#addSaleBtn')?.addEventListener('click', openSaleModal);
  // modal may be created later
}

function openSaleModal() {
  if (!qs('#saleModal')) {
    const modal = document.createElement('div');
    modal.id = 'saleModal';
    modal.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999';
    modal.innerHTML = `
      <div style="background:white;padding:20px;border-radius:8px;min-width:320px;max-width:520px;">
        <h3>Add Sale</h3>
        <label>Invoice</label><input id="sale_invoice" placeholder="Invoice id (optional)" />
        <label>Product (name or SKU)</label><input id="sale_product" placeholder="Product name or SKU" />
        <label>Quantity</label><input id="sale_quantity" type="number" min="1" value="1" />
        <label>Total (RM)</label><input id="sale_total" type="number" step="0.01" placeholder="0.00" />
        <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
          <button id="saveSaleBtn" class="primary-btn">Save</button>
          <button id="closeSaleBtn" class="secondary-btn">Close</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    qs('#closeSaleBtn').addEventListener('click', ()=> modal.remove());
    qs('#saveSaleBtn').addEventListener('click', addSale);
  } else {
    qs('#sale_invoice').value=''; qs('#sale_product').value=''; qs('#sale_quantity').value=1; qs('#sale_total').value='';
    qs('#saleModal').style.display = 'flex';
  }
}

async function addSale() {
  const invoice = qs('#sale_invoice')?.value?.trim();
  const product = qs('#sale_product')?.value?.trim();
  const quantity = Number(qs('#sale_quantity')?.value || 0);
  const total = Number(qs('#sale_total')?.value || 0);
  if (!product || quantity <= 0) return alert('Fill product and quantity');
  try {
    const res = await apiFetch(`${API_BASE}/sales`, { method: 'POST', body: JSON.stringify({ invoice, product, quantity, total }) });
    if (res.ok) {
      await fetchSales();
      await fetchLogs();
      alert('✅ Sale saved');
      qs('#saleModal') && qs('#saleModal').remove();
    } else {
      const err = await res.json();
      throw err;
    }
  } catch (err) {
    console.error('addSale error', err);
    alert('❌ Save failed');
  }
}

async function downloadSalesReportXLSX() {
  try {
    const res = await apiFetch(`${API_BASE}/sales/report`, { method: 'GET' });
    if (!res.ok) { const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="(.+?)"/);
    const filename = match ? match[1] : `Sales_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchSales();
  } catch (err) {
    console.error('downloadSalesReportXLSX', err);
    alert('❌ Failed to download');
  }
}

// -------------------- Orders (UI + API) --------------------
function bindOrdersUI() {
  qs('#downloadOrdersXLSXBtn')?.addEventListener('click', downloadOrdersReportXLSX);
  qs('#downloadOrdersXLSXBtnInline')?.addEventListener('click', downloadOrdersReportXLSX);
  qs('#downloadOrdersPDFBtn')?.addEventListener('click', () => downloadReportPDF('orders'));
  qs('#addOrderBtn')?.addEventListener('click', openOrderModal);
}

// Order modal & helper functions
function openOrderModal() {
  if (!qs('#orderModal')) {
    const modal = document.createElement('div');
    modal.id = 'orderModal';
    modal.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:flex-start;justify-content:center;padding-top:40px;z-index:9999';
    modal.innerHTML = `
      <div style="background:white;padding:18px;border-radius:8px;min-width:320px;max-width:900px;">
        <h3>Create Order</h3>
        <label>Customer Name</label><input id="order_customer" />
        <div id="order_items_container" style="margin-top:10px"></div>
        <div style="margin-top:8px;">
          <button id="addOrderItemBtn" class="secondary-btn">+ Add Item</button>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:12px;">
          <div>Total: RM <span id="order_total_display">0.00</span></div>
          <div style="flex:1"></div>
          <button id="saveOrderBtn" class="primary-btn">Save Order</button>
          <button id="orderModalCloseBtn" class="secondary-btn">Close</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    qs('#orderModalCloseBtn').addEventListener('click', ()=> modal.remove());
    qs('#addOrderItemBtn').addEventListener('click', addOrderItemRow);
    qs('#saveOrderBtn').addEventListener('click', saveOrderFromModal);
    // build one row
    addOrderItemRow();
  } else {
    // reset
    qs('#order_customer').value = '';
    qs('#order_items_container').innerHTML = '';
    addOrderItemRow();
    qs('#order_total_display').textContent = '0.00';
    qs('#orderModal').style.display = 'flex';
  }
}

function addOrderItemRow() {
  const container = qs('#order_items_container');
  if (!container) return;
  const row = document.createElement('div');
  row.style = 'display:flex;gap:8px;margin-top:8px;align-items:center';
  row.className = 'order-item-row';
  row.innerHTML = `
    <input class="order_sku" placeholder="SKU" style="min-width:90px" />
    <input class="order_name" placeholder="Name" style="flex:1" />
    <input class="order_qty" placeholder="Qty" type="number" min="1" value="1" style="width:80px" />
    <input class="order_price" placeholder="Price" type="number" step="0.01" value="0.00" style="width:110px" />
    <button class="danger-btn removeOrderItemBtn">Remove</button>
  `;
  container.appendChild(row);
  const qty = row.querySelector('.order_qty');
  const price = row.querySelector('.order_price');
  const removeBtn = row.querySelector('.removeOrderItemBtn');
  qty.addEventListener('input', updateOrderTotalFromModal);
  price.addEventListener('input', updateOrderTotalFromModal);
  removeBtn.addEventListener('click', () => { row.remove(); updateOrderTotalFromModal(); });
  updateOrderTotalFromModal();
}

function updateOrderTotalFromModal() {
  const rows = qsa('#order_items_container .order-item-row');
  let total = 0;
  rows.forEach(r => {
    const q = Number(r.querySelector('.order_qty')?.value || 0);
    const p = Number(r.querySelector('.order_price')?.value || 0);
    total += q * p;
  });
  qs('#order_total_display').textContent = total.toFixed(2);
}

async function saveOrderFromModal() {
  const customer = qs('#order_customer')?.value?.trim();
  if (!customer) return alert('Enter customer name');
  const rows = qsa('#order_items_container .order-item-row');
  if (rows.length === 0) return alert('Add items');
  const items = rows.map(r => ({
    sku: r.querySelector('.order_sku')?.value?.trim(),
    name: r.querySelector('.order_name')?.value?.trim(),
    qty: Number(r.querySelector('.order_qty')?.value || 0),
    price: Number(r.querySelector('.order_price')?.value || 0)
  }));
  const total = items.reduce((s,i) => s + (Number(i.qty||0) * Number(i.price||0)), 0);
  try {
    const res = await apiFetch(`${API_BASE}/orders`, { method: 'POST', body: JSON.stringify({ customerName: customer, items, total }) });
    if (res.ok) {
      await fetchOrders();
      await fetchLogs();
      alert('✅ Order saved');
      qs('#orderModal') && qs('#orderModal').remove();
    } else {
      const err = await res.json(); throw err;
    }
  } catch (err) {
    console.error('saveOrder', err);
    alert('❌ Failed to save order');
  }
}

async function downloadOrdersReportXLSX() {
  try {
    const res = await apiFetch(`${API_BASE}/orders/report`, { method: 'GET' });
    if (!res.ok) { const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="(.+?)"/);
    const filename = match ? match[1] : `Orders_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchOrders();
  } catch (err) {
    console.error('downloadOrdersReportXLSX', err);
    alert('❌ Failed to download');
  }
}

// -------------------- Settings bindings --------------------
function bindSettingPage() {
  const currentUser = getUsername();
  if (qs('#currentUser')) qs('#currentUser').textContent = currentUser;

  qs('#changePasswordBtn')?.addEventListener('click', async () => {
    const newPass = qs('#newPassword')?.value;
    const conf = qs('#confirmPassword')?.value;
    const code = qs('#securityCode')?.value;
    const msgEl = qs('#passwordMessage');
    showMsg(msgEl, '');
    if (!newPass || !conf || !code) return showMsg(msgEl, 'Fill all fields', 'red');
    if (newPass !== conf) return showMsg(msgEl, 'Passwords do not match', 'red');
    if (!confirm('Change password?')) return;
    try {
      const res = await apiFetch(`${API_BASE}/account/password`, { method: 'PUT', body: JSON.stringify({ username: currentUser, newPassword: newPass, securityCode: code }) });
      const data = await res.json();
      if (res.ok) {
        showMsg(msgEl, '✅ Password updated. Logging out...', 'green');
        setTimeout(() => { sessionStorage.removeItem('isLoggedIn'); sessionStorage.removeItem('adminName'); window.location.href = 'login.html'; }, 1400);
      } else showMsg(msgEl, `❌ ${data.message||'Failed'}`, 'red');
    } catch (err) {
      console.error('change password', err);
      showMsg(msgEl, '❌ Server error', 'red');
    }
  });

  qs('#deleteAccountBtn')?.addEventListener('click', async () => {
    const current = currentUser;
    if (!confirm(`Delete account "${current}"? This action is irreversible.`)) return;
    const code = prompt('Enter Admin Security Code:');
    if (!code) return alert('Cancelled');
    try {
      const res = await apiFetch(`${API_BASE}/account`, { method: 'DELETE', body: JSON.stringify({ username: current, securityCode: code }) });
      const data = await res.json();
      if (res.ok) { alert('Account deleted'); sessionStorage.removeItem('isLoggedIn'); sessionStorage.removeItem('adminName'); window.location.href = 'login.html'; }
      else alert(`Failed: ${data.message || ''}`);
    } catch (err) {
      console.error('delete account', err);
      alert('❌ Server error');
    }
  });
}

// -------------------- Initial bindings --------------------
window.addEventListener('load', async () => {
  // set admin name (header)
  const admin = getUsername();
  if (qs('#adminName')) qs('#adminName').textContent = admin;

  // theme
  try {
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode');
  } catch (e) {}

  // page-specific initialization
  try {
    if (currentPage.includes('inventory')) {
      await fetchInventory();
      bindInventoryUI();
      qs('#reportBtn')?.addEventListener('click', confirmAndGenerateInventoryXLSX);
      // Add PDF button if present
      qs('#downloadInventoryPDFBtn')?.addEventListener('click', () => downloadReportPDF('inventory'));
    }
    if (currentPage.includes('documents')) {
      await fetchDocuments();
      bindDocumentsUI();
      qs('#downloadDocsXLSXBtn')?.addEventListener('click', confirmAndGenerateInventoryXLSX); // optional: same inventory report button
      qs('#downloadDocsPDFBtn')?.addEventListener('click', () => downloadReportPDF('inventory'));
    }
    if (currentPage.includes('sales')) {
      await fetchSales();
      bindSalesUI();
    }
    if (currentPage.includes('orders')) {
      await fetchOrders();
      bindOrdersUI();
    }
    if (currentPage.includes('log') || currentPage === '' || currentPage === 'index.html') {
      await fetchLogs();
      await fetchInventory();
      // dash elements
      qs('#downloadAllZipBtn')?.addEventListener('click', downloadAllReportsZip);
      // chart
      initOrUpdateInventoryChart();
    }
    if (currentPage.includes('product')) {
      bindProductPage();
    }
    if (currentPage.includes('setting')) {
      bindSettingPage();
    }
    // login/register (if on login page)
    if (currentPage.includes('login.html')) {
      qs('#loginBtn')?.addEventListener('click', login);
      qs('#registerBtn')?.addEventListener('click', async () => {
        const user = qs('#newUsername')?.value?.trim();
        const pass = qs('#newPassword')?.value?.trim();
        const code = qs('#securityCode')?.value?.trim();
        const msg = qs('#registerMessage');
        showMsg(msg, '');
        if (!user || !pass || !code) return showMsg(msg, 'Fill all fields', 'red');
        try {
          const res = await apiFetch(`${API_BASE}/register`, { method: 'POST', body: JSON.stringify({ username: user, password: pass, securityCode: code }) });
          const data = await res.json();
          if (res.ok) { showMsg(msg, '✅ Registered. Login now.', 'green'); setTimeout(()=>{ qs('#toggleToLogin')?.click?.(); }, 900); }
          else showMsg(msg, `❌ ${data.message||'Failed'}`, 'red');
        } catch (err) { console.error('register', err); showMsg(msg, 'Server error', 'red'); }
      });
      qs('#toggleToRegister')?.addEventListener('click', ()=> {
        if (qs('#loginForm')) qs('#loginForm').style.display = 'none';
        if (qs('#registerForm')) qs('#registerForm').style.display = 'block';
      });
      qs('#toggleToLogin')?.addEventListener('click', ()=> {
        if (qs('#loginForm')) qs('#loginForm').style.display = 'block';
        if (qs('#registerForm')) qs('#registerForm').style.display = 'none';
      });
    }
  } catch (err) {
    console.error('init error', err);
  }
});

// -------------------- Expose some globals used by HTML inline handlers --------------------
window.logout = () => { sessionStorage.removeItem('isLoggedIn'); sessionStorage.removeItem('adminName'); window.location.href = 'login.html'; };
window.toggleTheme = () => { document.body.classList.toggle('dark-mode'); try { localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light'); } catch(e) {} };
window.openEditPageForItem = (id) => { window.location.href = `product.html?id=${encodeURIComponent(id)}`; };
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;
window.downloadSalesReportXLSX = downloadSalesReportXLSX;
window.downloadOrdersReportXLSX = downloadOrdersReportXLSX;
window.downloadAllReportsZip = downloadAllReportsZip;
window.downloadReportPDF = downloadReportPDF;
