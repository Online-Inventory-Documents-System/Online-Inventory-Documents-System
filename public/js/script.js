// public/js/script.js
// Complete client-side script for Online Inventory & Documents System
// Updated for Orders, Sales, Company Config, Auto-Calculations, and PDF Reports

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api"; // change if needed

// Utilities
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';
const moneyFormat = (num) => `RM ${Number(num || 0).toFixed(2)}`;

let inventory = [];
let activityLog = [];
let documents = [];
let orders = []; 
let sales = []; 
let companyConfig = { taxRate: 0.00 }; 
const currentPage = window.location.pathname.split('/').pop();

// Fetch wrapper
async function apiFetch(url, options = {}) {
  const user = getUsername();
  options.headers = {
    'Content-Type': 'application/json',
    'X-Username': user,
    ...options.headers
  };
  return fetch(url, options);
}

// Auth redirect (do not redirect when on login page)
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  try { window.location.href = 'login.html'; } catch(e) {}
}

function logout(){
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('adminName');
  if(window.CONFIG && CONFIG.LS_THEME) localStorage.removeItem(CONFIG.LS_THEME);
  window.location.href = 'login.html';
}

function toggleTheme(){
  document.body.classList.toggle('dark-mode');
  if(window.CONFIG && CONFIG.LS_THEME) {
    localStorage.setItem(CONFIG.LS_THEME, document.body.classList.contains('dark-mode') ? 'dark' : 'light');
  }
}

// ===== Common Fetch Functions =====

async function fetchInventory() {
  try {
    const res = await apiFetch(`${API_BASE}/inventory`);
    inventory = await res.json();
    inventory.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if(currentPage.includes('inventory.html')) renderInventory(inventory);
    // Initialize Add/Edit Order/Sale pages once inventory is loaded
    if(currentPage.includes('order.html')) initOrderSalePage(true);
    if(currentPage.includes('sale.html')) initOrderSalePage(false);
    return inventory;
  } catch(e) { console.error('Error fetching inventory:', e); }
}

async function fetchOrders() {
  try {
    const res = await apiFetch(`${API_BASE}/orders`);
    orders = await res.json();
    if(currentPage.includes('orders.html')) renderOrders(orders);
    if(currentPage.includes('index.html')) renderDashboardData(); 
  } catch(e) { console.error('Error fetching orders:', e); }
}

async function fetchSales() {
  try {
    const res = await apiFetch(`${API_BASE}/sales`);
    sales = await res.json();
    if(currentPage.includes('sales.html')) renderSales(sales);
    if(currentPage.includes('index.html')) renderDashboardData();
  } catch(e) { console.error('Error fetching sales:', e); }
}

async function fetchCompanyConfig() {
  try {
    const res = await apiFetch(`${API_BASE}/company-config`);
    companyConfig = await res.json();
    if(currentPage.includes('company.html')) renderCompanyConfig();
    return companyConfig;
  } catch(e) { console.error('Error fetching config:', e); }
}

// Initial data fetch based on page
async function initDataFetch() {
  if (currentPage.includes('login.html')) return;
  
  await fetchCompanyConfig();

  if(currentPage.includes('index.html') || currentPage.includes('order.html') || currentPage.includes('sale.html')) {
    await fetchInventory(); 
  }
  if(currentPage.includes('index.html') || currentPage.includes('orders.html') || currentPage.includes('order.html')) await fetchOrders();
  if(currentPage.includes('index.html') || currentPage.includes('sales.html') || currentPage.includes('sale.html')) await fetchSales();
  if(currentPage.includes('documents.html')) await fetchDocuments();
  if(currentPage.includes('log.html') || currentPage.includes('index.html')) await fetchLogs();
  
  if(currentPage.includes('product.html')) initProductPage();
  if(currentPage.includes('setting.html')) initSettingPage();
}
document.addEventListener('DOMContentLoaded', initDataFetch);

// ===== PDF Report Generation (NEW) =====
async function generatePDFReport(id, type) {
  const isInventory = type === 'inventory';
  const endpoint = isInventory ? `${API_BASE}/inventory/report` : `${API_BASE}/${type}s/report/${id}`;
  
  if(!confirm(`Confirm Generate PDF Report for ${isInventory ? 'Inventory' : type} ${isInventory ? '' : id}?`)) return;

  try {
    const res = await apiFetch(endpoint, { method: 'GET' });
    
    if(res.ok) {
      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition ? contentDisposition.match(/filename="(.+?)"/) : null;
      const filename = filenameMatch ? filenameMatch[1] : `${type}_Report_${Date.now()}.pdf`;
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      alert(`✅ ${type.toUpperCase()} PDF Report generated successfully!`);
    } else {
      const err = await res.json();
      alert('❌ Failed to generate report: ' + (err.message || 'Unknown error.'));
    }
  } catch(e) {
    console.error(e);
    alert('❌ Server connection error while generating report.');
  }
}
window.generatePDFReport = generatePDFReport;

// Update existing inventory function to use PDF
async function confirmAndGenerateReport() {
  generatePDFReport(null, 'inventory');
}
window.confirmAndGenerateReport = confirmAndGenerateReport;

// ===== Inventory Renderers (Updated for PDF button) =====

function renderInventory(items) {
  const list = qs('#inventoryList');
  if(!list) return;
  list.innerHTML = '';
  let totalValue = 0, totalRevenue = 0, totalStock = 0;

  items.forEach(it => {
    const id = it.id || it._id;
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const invVal = qty * uc;
    const rev = qty * up;
    totalValue += invVal;
    totalRevenue += rev;
    totalStock += qty;

    const tr = document.createElement('tr');
    if(qty === 0) tr.classList.add('out-of-stock-row');
    else if(qty < 10) tr.classList.add('low-stock-row');

    tr.innerHTML = `
      <td>${escapeHtml(it.sku||'')}</td>
      <td>${escapeHtml(it.name||'')}</td>
      <td>${escapeHtml(it.category||'')}</td>
      <td>${qty}</td>
      <td class="money">${moneyFormat(uc)}</td>
      <td class="money">${moneyFormat(up)}</td>
      <td class="money">${moneyFormat(invVal)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditPageForItem('${id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="confirmAndDeleteItem('${id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });

  if(qs('#totalValue')) qs('#totalValue').textContent = totalValue.toFixed(2);
  if(qs('#totalRevenue')) qs('#totalRevenue').textContent = totalRevenue.toFixed(2);
  if(qs('#totalStock')) qs('#totalStock').textContent = totalStock;
}

// DOM binding update for inventory.html button
qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport); 

// ===== Dashboard Renderers (Updated) =====
function renderDashboardData(){ 
  const totalItems = inventory.length;
  const totalStock = inventory.reduce((sum, i) => sum + (i.quantity || 0), 0);
  const totalValue = inventory.reduce((sum, i) => sum + (i.quantity || 0) * (i.unitCost || 0), 0);
  
  const totalOrders = orders.length;
  const totalSales = sales.length;
  const totalSalesRevenue = sales.reduce((sum, s) => sum + s.grandTotal, 0);

  if(qs('#dash_totalItems')) qs('#dash_totalItems').textContent = totalItems;
  if(qs('#dash_totalValue')) qs('#dash_totalValue').textContent = totalValue.toFixed(2);
  if(qs('#dash_totalRevenue')) qs('#dash_totalRevenue').textContent = inventory.reduce((sum, i) => sum + (i.quantity || 0) * (i.unitPrice || 0), 0).toFixed(2);
  if(qs('#dash_totalStock')) qs('#dash_totalStock').textContent = totalStock;

  if(qs('#dash_totalOrders')) qs('#dash_totalOrders').textContent = totalOrders;
  if(qs('#dash_totalSales')) qs('#dash_totalSales').textContent = totalSales;
  if(qs('#dash_totalRevenueTotal')) qs('#dash_totalRevenueTotal').textContent = totalSalesRevenue.toFixed(2);

  const recentLogList = qs('#recentActivities');
  if(recentLogList) {
      recentLogList.innerHTML = '';
      [...activityLog].slice(0, 5).forEach(l => {
        const timeStr = l.time ? new Date(l.time).toLocaleTimeString() : '';
        const dateStr = l.time ? new Date(l.time).toLocaleDateString() : '';
        recentLogList.innerHTML += `
            <tr>
                <td>${escapeHtml(l.user||'System')}</td>
                <td>${escapeHtml(l.action||'')}</td>
                <td>${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</td>
            </tr>
        `;
    });
  }
}
window.renderDashboardData = renderDashboardData;


// ===== Order/Sale Common Functions (NEW) =====

function initOrderSalePage(isOrder) {
    const entity = isOrder ? 'order' : 'sale';
    const formId = isOrder ? 'orderForm' : 'saleForm';
    
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('id');

    const itemSelect = qs(`#${formId} #itemSelect`);
    if(itemSelect && inventory.length > 0) {
        itemSelect.innerHTML = '<option value="">-- Select Inventory Item --</option>';
        inventory.forEach(item => {
            const price = isOrder ? item.unitCost : item.unitPrice;
            itemSelect.innerHTML += `<option 
                                        value="${item.id}" 
                                        data-sku="${escapeHtml(item.sku)}" 
                                        data-name="${escapeHtml(item.name)}" 
                                        data-price="${price}">
                                        ${escapeHtml(item.name)} (SKU: ${escapeHtml(item.sku)} | ${moneyFormat(price)})
                                    </option>`;
        });
    }

    qs(`#${formId} #addItemBtn`)?.addEventListener('click', () => addLineItem(isOrder));
    qs(`#${formId} #save${isOrder ? 'Order' : 'Sale'}Btn`)?.addEventListener('click', () => saveOrderSale(editId, isOrder));
    
    if (editId) {
        const data = (isOrder ? orders : sales).find(o => o.id === editId);
        if (data) {
            populateOrderSaleForm(data, isOrder);
            qs(`#${formId} #save${isOrder ? 'Order' : 'Sale'}Btn`).textContent = `💾 Save Changes to ${isOrder ? 'Order' : 'Sale'}`;
            qs(`#${formId} h1`).textContent = `✏️ Edit ${isOrder ? 'Purchase Order' : 'Sales Transaction'} ${data[isOrder ? 'orderNumber' : 'saleNumber']}`;
            qs(`#${formId} h2`).textContent = `Edit Details - ${data[isOrder ? 'orderNumber' : 'saleNumber']}`;
        } else {
            alert(`${isOrder ? 'Order' : 'Sale'} not found.`);
            window.location.href = `${isOrder ? 'orders' : 'sales'}.html`;
        }
    } else {
        // Run initial calculation for a new empty form
        calculateOrderSaleTotals(entity); 
    }
}
window.initOrderSalePage = initOrderSalePage;

function addLineItem(isOrder) {
    const entity = isOrder ? 'order' : 'sale';
    const itemSelect = qs(`#${entity}Form #itemSelect`);
    const qtyInput = qs(`#${entity}Form #itemQuantity`);
    const itemsList = qs(`#${entity}Form #lineItems`);
    const selectedOption = itemSelect.options[itemSelect.selectedIndex];
    
    const inventoryId = selectedOption.value;
    const quantity = parseInt(qtyInput.value);
    
    if (!inventoryId || quantity <= 0) {
        alert('Please select an item and enter a valid quantity (> 0).');
        return;
    }
    
    const existingRow = itemsList.querySelector(`tr[data-inventory-id="${inventoryId}"]`);
    if (existingRow) {
        alert('Item already added. Remove the existing item or use the quantity field in the list to update.');
        return;
    }

    const sku = selectedOption.getAttribute('data-sku');
    const name = selectedOption.getAttribute('data-name');
    const unitPrice = parseFloat(selectedOption.getAttribute('data-price'));
    const total = quantity * unitPrice;

    const newRow = document.createElement('tr');
    newRow.setAttribute('data-inventory-id', inventoryId);
    newRow.innerHTML = `
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(sku)}</td>
        <td><input type="number" min="1" value="${quantity}" class="item-qty-input" oninput="calculateLineTotal(this)" data-unit-price="${unitPrice}" /></td>
        <td class="money">${moneyFormat(unitPrice)}</td>
        <td class="money line-total">${moneyFormat(total)}</td>
        <td class="actions">
            <button class="danger-btn small-btn" onclick="this.closest('tr').remove(); calculateOrderSaleTotals('${entity}')">🗑️ Remove</button>
        </td>
    `;
    itemsList.appendChild(newRow);

    calculateOrderSaleTotals(entity);
    itemSelect.selectedIndex = 0;
    qtyInput.value = 1;
}
window.addLineItem = addLineItem;

function calculateLineTotal(inputEl) {
    const quantity = parseInt(inputEl.value) || 0;
    const unitPrice = parseFloat(inputEl.getAttribute('data-unit-price')) || 0;
    const total = quantity * unitPrice;
    const totalEl = inputEl.closest('tr').querySelector('.line-total');
    if (totalEl) totalEl.textContent = moneyFormat(total);
    calculateOrderSaleTotals(inputEl.closest('form').id.includes('order') ? 'order' : 'sale');
}
window.calculateLineTotal = calculateLineTotal;

function calculateOrderSaleTotals(entity) {
    const rows = qsa(`#${entity}Form #lineItems tr`);
    let subtotal = 0;

    rows.forEach(row => {
        const qty = parseInt(row.querySelector('.item-qty-input').value) || 0;
        const price = parseFloat(row.querySelector('.item-qty-input').getAttribute('data-unit-price')) || 0;
        subtotal += qty * price;
    });

    const taxRate = companyConfig.taxRate || 0.00;
    const taxAmount = subtotal * taxRate;
    const grandTotal = subtotal + taxAmount;

    qs(`#${entity}Form #subtotal`).textContent = moneyFormat(subtotal);
    qs(`#${entity}Form #taxRateDisplay`).textContent = (taxRate * 100).toFixed(2);
    qs(`#${entity}Form #taxAmount`).textContent = moneyFormat(taxAmount);
    qs(`#${entity}Form #grandTotal`).textContent = moneyFormat(grandTotal);
}
window.calculateOrderSaleTotals = calculateOrderSaleTotals;

function gatherLineItems(entity) {
    const rows = qsa(`#${entity}Form #lineItems tr`);
    
    return rows.map(row => {
        const inventoryId = row.getAttribute('data-inventory-id');
        const name = row.cells[0].textContent;
        const sku = row.cells[1].textContent;
        const inputEl = row.querySelector('.item-qty-input');
        const quantity = parseInt(inputEl.value);
        const unitPrice = parseFloat(inputEl.getAttribute('data-unit-price'));
        const total = quantity * unitPrice;

        return { inventoryId, name, sku, quantity, unitPrice, total };
    });
}

function populateOrderSaleForm(data, isOrder) {
    const entity = isOrder ? 'order' : 'sale';
    const formId = isOrder ? 'orderForm' : 'saleForm';
    const itemsList = qs(`#${formId} #lineItems`);
    
    qs(`#${formId} #customerName`).value = data.customerName || '';
    qs(`#${formId} #contact`).value = data.contact || '';
    qs(`#${formId} #status`).value = data.status || 'Pending';
    
    itemsList.innerHTML = ''; 

    data.items.forEach(item => {
        const unitPrice = item.unitPrice; // Use the fixed price saved on the transaction
        
        const newRow = document.createElement('tr');
        newRow.setAttribute('data-inventory-id', item.inventoryId);
        newRow.innerHTML = `
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.sku)}</td>
            <td><input type="number" min="1" value="${item.quantity}" class="item-qty-input" oninput="calculateLineTotal(this)" data-unit-price="${unitPrice}" /></td>
            <td class="money">${moneyFormat(unitPrice)}</td>
            <td class="money line-total">${moneyFormat(item.total)}</td>
            <td class="actions">
                <button class="danger-btn small-btn" onclick="this.closest('tr').remove(); calculateOrderSaleTotals('${entity}')">🗑️ Remove</button>
            </td>
        `;
        itemsList.appendChild(newRow);
    });
    
    calculateOrderSaleTotals(entity);
}

async function saveOrderSale(id, isOrder) {
    const entity = isOrder ? 'order' : 'sale';
    const msgEl = qs(`#${entity}Form #message`);
    const items = gatherLineItems(entity);
    
    if (items.length === 0) {
        showMsg(msgEl, 'Please add at least one item.', 'red');
        return;
    }
    
    const payload = {
        customerName: qs(`#${entity}Form #customerName`).value,
        contact: qs(`#${entity}Form #contact`).value,
        status: qs(`#${entity}Form #status`).value,
        items: items
    };

    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_BASE}/${entity}s/${id}` : `${API_BASE}/${entity}s`;

    showMsg(msgEl, 'Saving...', 'gray');
    
    try {
        const res = await apiFetch(url, { method, body: JSON.stringify(payload) });
        const data = await res.json();
        
        if(res.ok) {
            showMsg(msgEl, `✅ ${entity} saved successfully! Redirecting...`, 'green');
            setTimeout(() => {
                fetchInventory(); 
                window.location.href = `${entity}s.html`;
            }, 700);
        } else {
            showMsg(msgEl, `❌ Failed to save ${entity}: ${data.message || 'Unknown error.'}`, 'red');
        }
    } catch(e) {
        console.error(e);
        showMsg(msgEl, '❌ Server connection error.', 'red');
    }
}
window.saveOrderSale = saveOrderSale;

// ===== Orders List Functions (NEW) =====

function renderOrders(currentOrders) {
    const list = qs('#orderList');
    if(!list) return;
    list.innerHTML = '';

    currentOrders.forEach(o => {
        const id = o.id || o._id;
        const totalItems = o.items.reduce((sum, item) => sum + item.quantity, 0);
        const statusClass = o.status.toLowerCase();

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(o.orderNumber)}</td>
            <td>${escapeHtml(o.customerName)}</td>
            <td>${totalItems}</td>
            <td class="money">${moneyFormat(o.grandTotal)}</td>
            <td class="status-cell ${statusClass}">${escapeHtml(o.status)}</td>
            <td class="actions">
                <button class="primary-btn small-btn" onclick="openEditPageForOrder('${id}')">✏️ Edit</button>
                <button class="danger-btn small-btn" onclick="confirmAndDeleteOrder('${id}')">🗑️ Delete</button>
                <button class="secondary-btn small-btn" onclick="generatePDFReport('${id}', 'order')">📄 PDF Report</button>
            </td>
        `;
        list.appendChild(tr);
    });
}
window.renderOrders = renderOrders;

function openEditPageForOrder(id) { window.location.href = `order.html?id=${id}`; }
window.openEditPageForOrder = openEditPageForOrder;

async function confirmAndDeleteOrder(id) {
    const order = orders.find(o => o.id === id);
    if (!order) return alert('Order not found.');
    if(!confirm(`Are you sure you want to delete Order ${order.orderNumber}? If the order was Approved, stock changes will be reversed.`)) return;
    
    try {
        const res = await apiFetch(`${API_BASE}/orders/${id}`, { method: 'DELETE' });
        if(res.status === 204) {
            await fetchOrders();
            await fetchInventory(); 
            alert('🗑️ Order deleted! Inventory updated.');
        } else {
            const err = await res.json();
            alert('❌ Failed to delete order: ' + (err.message || 'Unknown'));
        }
    } catch(e) { 
        console.error(e); 
        alert('❌ Server connection error while deleting order.'); 
    }
}
window.confirmAndDeleteOrder = confirmAndDeleteOrder;

// ===== Sales List Functions (NEW) =====

function renderSales(currentSales) {
    const list = qs('#saleList');
    if(!list) return;
    list.innerHTML = '';

    currentSales.forEach(s => {
        const id = s.id || s._id;
        const totalItems = s.items.reduce((sum, item) => sum + item.quantity, 0);
        const statusClass = s.status.toLowerCase();

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(s.saleNumber)}</td>
            <td>${escapeHtml(s.customerName)}</td>
            <td>${totalItems}</td>
            <td class="money">${moneyFormat(s.grandTotal)}</td>
            <td class="status-cell ${statusClass}">${escapeHtml(s.status)}</td>
            <td class="actions">
                <button class="primary-btn small-btn" onclick="openEditPageForSale('${id}')">✏️ Edit</button>
                <button class="danger-btn small-btn" onclick="confirmAndDeleteSale('${id}')">🗑️ Delete</button>
                <button class="secondary-btn small-btn" onclick="generatePDFReport('${id}', 'sale')">📄 PDF Report</button>
            </td>
        `;
        list.appendChild(tr);
    });
}
window.renderSales = renderSales;

function openEditPageForSale(id) { window.location.href = `sale.html?id=${id}`; }
window.openEditPageForSale = openEditPageForSale;

async function confirmAndDeleteSale(id) {
    const sale = sales.find(s => s.id === id);
    if (!sale) return alert('Sale not found.');
    if(!confirm(`Are you sure you want to delete Sale ${sale.saleNumber}? If the sale was Approved, stock changes will be reversed.`)) return;
    
    try {
        const res = await apiFetch(`${API_BASE}/sales/${id}`, { method: 'DELETE' });
        if(res.status === 204) {
            await fetchSales();
            await fetchInventory(); 
            alert('🗑️ Sale deleted! Inventory updated.');
        } else {
            const err = await res.json();
            alert('❌ Failed to delete sale: ' + (err.message || 'Unknown'));
        }
    } catch(e) { 
        console.error(e); 
        alert('❌ Server connection error while deleting sale.'); 
    }
}
window.confirmAndDeleteSale = confirmAndDeleteSale;

// ===== Company Config Functions (NEW) =====

function renderCompanyConfig() {
  if (currentPage.includes('company.html')) {
    qs('#companyName').value = companyConfig.companyName || '';
    qs('#companyAddress').value = companyConfig.address || '';
    qs('#companyPhone').value = companyConfig.phone || '';
    qs('#companyEmail').value = companyConfig.email || '';
    qs('#taxRate').value = (companyConfig.taxRate * 100).toFixed(2);
  }
}

async function saveCompanyConfig() {
  const msgEl = qs('#configMessage');
  const taxRatePercent = qs('#taxRate').value;
  const newConfig = {
    companyName: qs('#companyName').value,
    address: qs('#companyAddress').value,
    phone: qs('#companyPhone').value,
    email: qs('#companyEmail').value,
    taxRate: (parseFloat(taxRatePercent) / 100) || 0.00
  };

  if (isNaN(parseFloat(taxRatePercent)) || parseFloat(taxRatePercent) < 0) {
    showMsg(msgEl, 'Invalid tax rate (must be a positive number).', 'red');
    return;
  }
  
  try {
    const res = await apiFetch(`${API_BASE}/company-config`, {
      method: 'PUT',
      body: JSON.stringify(newConfig)
    });
    
    const data = await res.json();
    if(res.ok) {
      showMsg(msgEl, '✅ Company configuration saved!', 'green');
      fetchCompanyConfig(); 
    } else {
      showMsg(msgEl, `❌ Failed to save config: ${data.message || 'Unknown error.'}`, 'red');
    }
  } catch(e) {
    console.error(e);
    showMsg(msgEl, '❌ Server connection error.', 'red');
  }
}
window.saveCompanyConfig = saveCompanyConfig;


// --- Existing functions (Auth, Product CRUD, Document/Log fetching) ---

// Assuming existing functions like login, register, initProductPage, saveProduct,
// fetchDocuments, fetchLogs, etc., are placed here.

// DOM bindings for new pages
document.addEventListener('DOMContentLoaded', ()=> {
  if(currentPage.includes('company.html')) {
    qs('#saveConfigBtn')?.addEventListener('click', saveCompanyConfig);
    qs('#cancelConfigBtn')?.addEventListener('click', ()=> window.location.href = 'setting.html');
  }
});

// Expose some functions for inline onclick handlers (Important)
window.logout = logout;
window.toggleTheme = toggleTheme;
// Other existing exposures:
// window.openEditPageForItem, window.confirmAndDeleteItem, 
// window.downloadDocument, window.deleteDocumentConfirm 
// ...
