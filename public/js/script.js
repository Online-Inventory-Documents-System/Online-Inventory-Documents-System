// public/js/script.js
// Complete client-side script for Online Inventory & Documents System
// Updated for Orders, Sales, Company Config, Auto-Calculations, and PDF/Excel Reports

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

// ===== Common Fetch Functions (Updated fetchInventory for button binding) =====

async function fetchInventory() {
  try {
    const res = await apiFetch(`${API_BASE}/inventory`);
    inventory = await res.json();
    inventory.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    
    if(currentPage.includes('inventory.html')) {
        renderInventory(inventory);
        
        // Bind the new report buttons after successful fetch on inventory.html
        const excelReportBtn = qs('#reportBtnExcel'); 
        if (excelReportBtn) {
            excelReportBtn.onclick = () => {
                if(confirm('Confirm Generate Inventory Report (Excel)?')) {
                    window.location.href = `${API_BASE}/inventory/report-excel`;
                }
            };
        }

        const pdfReportBtn = qs('#reportBtnPDF'); 
        if (pdfReportBtn) {
            pdfReportBtn.onclick = () => {
                if(confirm('Confirm Generate Inventory Report (PDF)?')) {
                    window.location.href = `${API_BASE}/inventory/report-pdf`;
                }
            };
        }
    }
    
    // Initialize Add/Edit Order/Sale pages once inventory is loaded
    if(currentPage.includes('order.html')) initOrderSalePage(true);
    if(currentPage.includes('sale.html')) initOrderSalePage(false);
    return inventory;
  } catch(e) { console.error('Error fetching inventory:', e); }
}

// Renamed for clarity in initDataFetch
async function fetchInventoryData() {
    await fetchInventory();
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

// --- LOGS and DOCUMENTS Fetch Functions ---
async function fetchLogs() {
  try {
    const res = await apiFetch(`${API_BASE}/log`);
    activityLog = await res.json();
    activityLog.sort((a, b) => new Date(b.time) - new Date(a.time));
    if(currentPage.includes('log.html')) renderLogs(activityLog);
    if(currentPage.includes('index.html')) renderDashboardData();
  } catch(e) { console.error('Error fetching logs:', e); }
}

async function fetchDocuments() {
  try {
    const res = await apiFetch(`${API_BASE}/documents`);
    documents = await res.json();
    documents.sort((a, b) => new Date(b.uploadTime) - new Date(a.uploadTime));
    if(currentPage.includes('documents.html')) renderDocuments(documents);
  } catch(e) { console.error('Error fetching documents:', e); }
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
  
  // Check and set username in the header
  const adminNameEl = qs('#adminName');
  if (adminNameEl) adminNameEl.textContent = getUsername();
    
  await fetchCompanyConfig();

  if(currentPage.includes('index.html') || currentPage.includes('order.html') || currentPage.includes('sale.html') || currentPage.includes('inventory.html')) {
    await fetchInventoryData(); 
  }
  if(currentPage.includes('index.html') || currentPage.includes('orders.html') || currentPage.includes('order.html')) await fetchOrders();
  if(currentPage.includes('index.html') || currentPage.includes('sales.html') || currentPage.includes('sale.html')) await fetchSales();
  if(currentPage.includes('documents.html')) await fetchDocuments();
  if(currentPage.includes('log.html') || currentPage.includes('index.html')) await fetchLogs();
  
  if(currentPage.includes('product.html')) initProductPage();
  if(currentPage.includes('setting.html')) initSettingPage();
}
document.addEventListener('DOMContentLoaded', initDataFetch);

// ===== PDF Report Generation (For Order/Sale) =====
async function generatePDFReport(id, type) {
  const endpoint = `${API_BASE}/${type}s/report-pdf/${id}`;
  
  if(!confirm(`Confirm Generate PDF Report for ${type} ${id}?`)) return;

  try {
    window.location.href = endpoint;
    alert(`✅ PDF Report generation started for ${type.toUpperCase()}. Check your downloads folder.`);
  } catch(e) {
    console.error(e);
    alert('❌ Server connection error while generating report.');
  }
}
window.generatePDFReport = generatePDFReport;


// ===== Inventory Functions (CRUD, Render, Search) =====

async function saveProduct(id) {
    const msgEl = qs('#addMessage') || qs('#productMessage');
    const isEdit = !!id;

    const payload = {
        sku: qs(isEdit ? '#prod_sku' : '#p_sku').value,
        name: qs(isEdit ? '#prod_name' : '#p_name').value,
        category: qs(isEdit ? '#prod_category' : '#p_category').value,
        quantity: parseInt(qs(isEdit ? '#prod_quantity' : '#p_quantity').value) || 0,
        unitCost: parseFloat(qs(isEdit ? '#prod_unitCost' : '#p_unitCost').value) || 0.00,
        unitPrice: parseFloat(qs(isEdit ? '#prod_unitPrice' : '#p_unitPrice').value) || 0.00
    };

    if (!payload.sku || !payload.name) {
        showMsg(msgEl, 'SKU and Name are required.', 'red');
        return;
    }

    const method = isEdit ? 'PUT' : 'POST';
    const url = isEdit ? `${API_BASE}/inventory/${id}` : `${API_BASE}/inventory`;

    showMsg(msgEl, 'Saving...', 'gray');

    try {
        const res = await apiFetch(url, {
            method: method,
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok) {
            showMsg(msgEl, `✅ Product ${isEdit ? 'updated' : 'added'} successfully!`, 'green');
            if (!isEdit) {
                // Clear inputs after adding new product
                qs('#p_sku').value = '';
                qs('#p_name').value = '';
                qs('#p_category').value = '';
                qs('#p_quantity').value = 0;
                qs('#p_unitCost').value = 0.00;
                qs('#p_unitPrice').value = 0.00;
            } else {
                // On edit page, redirect back after a short delay
                setTimeout(() => window.location.href = 'inventory.html', 700);
            }
            fetchInventoryData(); // Refresh list/dashboard data
        } else {
            showMsg(msgEl, `❌ Failed to save product: ${data.message || 'Unknown error.'}`, 'red');
        }
    } catch (e) {
        console.error(e);
        showMsg(msgEl, '❌ Server connection error.', 'red');
    }
}
window.saveProduct = saveProduct;

function openEditPageForItem(id) {
    window.location.href = `product.html?id=${id}`;
}
window.openEditPageForItem = openEditPageForItem;

async function confirmAndDeleteItem(id) {
    const item = inventory.find(i => i.id === id);
    if (!item) return alert('Item not found.');
    if (!confirm(`Are you sure you want to delete product: ${item.name} (${item.sku})?`)) return;

    try {
        const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method: 'DELETE' });
        if (res.status === 204) {
            alert('🗑️ Product deleted successfully!');
            fetchInventoryData(); // Refresh list
        } else {
            const err = await res.json();
            alert('❌ Failed to delete product: ' + (err.message || 'Unknown'));
        }
    } catch (e) {
        console.error(e);
        alert('❌ Server connection error while deleting product.');
    }
}
window.confirmAndDeleteItem = confirmAndDeleteItem;

function initProductPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('id');
    const saveBtn = qs('#saveProductBtn');

    if (editId) {
        const item = inventory.find(i => i.id === editId);
        if (item) {
            qs('#prod_id').value = item.id;
            qs('#prod_sku').value = item.sku || '';
            qs('#prod_name').value = item.name || '';
            qs('#prod_category').value = item.category || '';
            qs('#prod_quantity').value = item.quantity || 0;
            qs('#prod_unitCost').value = (item.unitCost || 0).toFixed(2);
            qs('#prod_unitPrice').value = (item.unitPrice || 0).toFixed(2);

            qs('#productForm h1').textContent = `✏️ Edit Product: ${item.name}`;
            saveBtn.textContent = '💾 Save Changes';
            saveBtn.onclick = () => saveProduct(editId);
        } else {
            alert('Product not found.');
            window.location.href = 'inventory.html';
        }
    } else if (saveBtn) {
        // This handles case where product.html is used for a new item (less common but safe)
        saveBtn.onclick = () => saveProduct(null); 
    }
}

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
  if(qs('#totalRevenue')) qs('#totalRevenue').textContent = (totalRevenue - totalValue).toFixed(2); // Show potential profit
  if(qs('#totalStock')) qs('#totalStock').textContent = totalStock;
}

function filterInventory() {
    const searchInput = qs('#searchInput').value.toLowerCase();
    const filtered = inventory.filter(item => 
        (item.sku && item.sku.toLowerCase().includes(searchInput)) ||
        (item.name && item.name.toLowerCase().includes(searchInput)) ||
        (item.category && item.category.toLowerCase().includes(searchInput))
    );
    renderInventory(filtered);
}

// DOM binding for inventory page
document.addEventListener('DOMContentLoaded', () => {
    // Inventory Add Product
    qs('#addProductBtn')?.addEventListener('click', () => saveProduct(null));

    // Inventory Search
    qs('#searchInput')?.addEventListener('input', filterInventory);
    qs('#clearSearchBtn')?.addEventListener('click', () => {
        qs('#searchInput').value = '';
        renderInventory(inventory);
    });

    if(currentPage.includes('product.html')) initProductPage();
});

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
                fetchInventoryData(); 
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
        const statusClass = o.status.toLowerCase().replace(/\s/g, '-');

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
            await fetchInventoryData(); 
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
        const statusClass = s.status.toLowerCase().replace(/\s/g, '-');

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
            await fetchInventoryData(); 
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


// --- Document Functions (Render, CRUD) ---

function renderDocuments(docs) {
    const list = qs('#docList');
    if(!list) return;
    list.innerHTML = '';

    docs.forEach(d => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(d.fileName)}</td>
            <td>${(d.sizeMB || 0).toFixed(2)}</td>
            <td>${new Date(d.uploadTime).toLocaleString()}</td>
            <td class="actions">
                <button class="primary-btn small-btn" onclick="downloadDocument('${d.id}')">⬇️ Download</button>
                <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${d.id}', '${escapeHtml(d.fileName)}')">🗑️ Delete</button>
            </td>
        `;
        list.appendChild(tr);
    });
}
window.renderDocuments = renderDocuments;

async function uploadDocuments() {
    const fileInput = qs('#docUpload');
    const msgEl = qs('#uploadMessage');
    const files = fileInput.files;

    if (files.length === 0) {
        showMsg(msgEl, 'Please select at least one file to upload.', 'red');
        return;
    }

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('documents', files[i]);
    }

    showMsg(msgEl, 'Uploading...', 'gray');

    try {
        const res = await apiFetch(`${API_BASE}/documents/upload`, {
            method: 'POST',
            body: formData,
            headers: { 'Content-Type': 'multipart/form-data', 'X-Username': getUsername() } // Fetch wrapper handles X-Username, but we manually remove Content-Type here if not handled by fetch wrapper
        });
        
        // Manual adjust: for FormData, we often let the browser set the Content-Type, 
        // so we use a standard fetch, but the existing apiFetch may enforce 'application/json'. 
        // Temporarily override headers for file upload:
        const fetchRes = await fetch(`${API_BASE}/documents/upload`, {
             method: 'POST',
             body: formData,
             headers: { 'X-Username': getUsername() }
        });
        const data = await fetchRes.json();
        
        if (fetchRes.ok) {
            showMsg(msgEl, `✅ Successfully uploaded ${data.uploadedCount} documents!`, 'green');
            fileInput.value = ''; // Clear file input
            fetchDocuments();
            fetchLogs();
        } else {
            showMsg(msgEl, `❌ Upload failed: ${data.message || 'Unknown error.'}`, 'red');
        }
    } catch(e) {
        console.error(e);
        showMsg(msgEl, '❌ Server connection error during upload.', 'red');
    }
}
window.uploadDocuments = uploadDocuments;

function downloadDocument(id) {
    // Client-side redirect to the file download endpoint
    window.location.href = `${API_BASE}/documents/${id}/download`;
    alert('⬇️ Download started. Check your downloads folder.');
}
window.downloadDocument = downloadDocument;

async function deleteDocumentConfirm(id, fileName) {
    if (!confirm(`Are you sure you want to delete document: ${fileName}?`)) return;

    try {
        const res = await apiFetch(`${API_BASE}/documents/${id}`, { method: 'DELETE' });
        if(res.status === 204) {
            alert('🗑️ Document deleted successfully!');
            fetchDocuments();
            fetchLogs();
        } else {
            const err = await res.json();
            alert('❌ Failed to delete document: ' + (err.message || 'Unknown'));
        }
    } catch(e) {
        console.error(e);
        alert('❌ Server connection error while deleting document.');
    }
}
window.deleteDocumentConfirm = deleteDocumentConfirm;

// --- Log Functions ---

function renderLogs(logs) {
    const list = qs('#logList');
    if(!list) return;
    list.innerHTML = '';
    
    logs.forEach(l => {
        const timeStr = l.time ? new Date(l.time).toLocaleTimeString() : '';
        const dateStr = l.time ? new Date(l.time).toLocaleDateString() : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(l.user||'System')}</td>
            <td>${escapeHtml(l.action||'')}</td>
            <td>${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</td>
        `;
        list.appendChild(tr);
    });
}
window.renderLogs = renderLogs;


// --- Auth Functions (Login/Register/Delete Account/Change Password) ---

// Assuming login, register, toggleForm, initSettingPage, changePassword, deleteAccountConfirm 
// are defined and working correctly as per previous steps. (They are included in the full script block.)

function login() {
    // Simplified logic, should use API in a real app
    const username = qs('#username').value;
    const password = qs('#password').value;
    const msgEl = qs('#loginMessage');

    if (!username || !password) {
        showMsg(msgEl, 'Please enter username and password.', 'red');
        return;
    }

    apiFetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ username, password })
    }).then(res => res.json())
      .then(data => {
        if(data.success) {
            sessionStorage.setItem('isLoggedIn', 'true');
            sessionStorage.setItem('adminName', username);
            showMsg(msgEl, '✅ Login successful! Redirecting...', 'green');
            setTimeout(() => window.location.href = 'index.html', 500);
        } else {
            showMsg(msgEl, `❌ Login failed: ${data.message || 'Invalid credentials.'}`, 'red');
        }
      }).catch(e => {
        console.error(e);
        showMsg(msgEl, '❌ Server connection error.', 'red');
      });
}
window.login = login;

function register() {
    const username = qs('#newUsername').value;
    const password = qs('#newPassword').value;
    const code = qs('#securityCode').value;
    const msgEl = qs('#registerMessage');

    if (!username || !password || !code) {
        showMsg(msgEl, 'All fields are required.', 'red');
        return;
    }

    apiFetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        body: JSON.stringify({ username, password, securityCode: code })
    }).then(res => res.json())
      .then(data => {
        if(data.success) {
            showMsg(msgEl, '✅ Registration successful! You can now log in.', 'green');
            toggleForm();
        } else {
            showMsg(msgEl, `❌ Registration failed: ${data.message || 'Invalid security code or username taken.'}`, 'red');
        }
      }).catch(e => {
        console.error(e);
        showMsg(msgEl, '❌ Server connection error.', 'red');
      });
}
window.register = register;

function toggleForm() {
    const loginForm = qs('#loginForm');
    const registerForm = qs('#registerForm');
    const formTitle = qs('#formTitle');

    if (loginForm.style.display === 'none') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        formTitle.textContent = '🔐 User Login';
        qs('#loginMessage').textContent = '';
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        formTitle.textContent = '📝 Register New Account';
        qs('#registerMessage').textContent = '';
    }
}
window.toggleForm = toggleForm;

function initSettingPage() {
  const currentUsername = getUsername();
  if (qs('#currentUser')) qs('#currentUser').textContent = currentUsername;

  qs('#changePasswordBtn')?.addEventListener('click', changePassword);
  qs('#deleteAccountBtn')?.addEventListener('click', deleteAccountConfirm);
}

async function changePassword() {
    const newPassword = qs('#newPassword').value;
    const confirmPassword = qs('#confirmPassword').value;
    const securityCode = qs('#securityCode').value;
    const msgEl = qs('#passwordMessage');
    const username = getUsername();

    if (newPassword !== confirmPassword) {
        showMsg(msgEl, 'New passwords do not match.', 'red');
        return;
    }
    if (!newPassword || !securityCode) {
        showMsg(msgEl, 'Password and security code are required.', 'red');
        return;
    }

    showMsg(msgEl, 'Changing password...', 'gray');

    try {
        const res = await apiFetch(`${API_BASE}/account/password`, {
            method: 'PUT',
            body: JSON.stringify({ username, newPassword, securityCode })
        });
        const data = await res.json();
        if (res.ok) {
            showMsg(msgEl, '✅ Password changed successfully!', 'green');
            qs('#newPassword').value = '';
            qs('#confirmPassword').value = '';
            qs('#securityCode').value = '';
        } else {
            showMsg(msgEl, `❌ Failed to change password: ${data.message || 'Invalid security code.'}`, 'red');
        }
    } catch (e) {
        console.error(e);
        showMsg(msgEl, '❌ Server connection error.', 'red');
    }
}
window.changePassword = changePassword;

async function deleteAccountConfirm() {
  const currentUsername = getUsername();
  if (!confirm(`Are you sure you want to delete the account for "${currentUsername}"?`)) return;
  const code = prompt('Enter Admin Security Code to CONFIRM account deletion:');
  if(!code) return alert('Deletion cancelled.');
  try {
    const res = await apiFetch(`${API_BASE}/account`, { 
      method: 'DELETE', 
      body: JSON.stringify({ username: currentUsername, securityCode: code }) 
    });
    const data = await res.json();
    if(res.ok) { 
      alert('🗑️ Account deleted successfully. You will now be logged out.'); 
      logout(); 
    }
    else alert(`❌ ${data.message || 'Failed to delete account.'}`);
  } catch(e) { 
    alert('❌ Server connection failed during account deletion.'); 
  }
}
window.deleteAccountConfirm = deleteAccountConfirm;


// DOM bindings for new pages
document.addEventListener('DOMContentLoaded', ()=> {
  if(currentPage.includes('company.html')) {
    qs('#saveConfigBtn')?.addEventListener('click', saveCompanyConfig);
    qs('#cancelConfigBtn')?.addEventListener('click', ()=> window.location.href = 'setting.html');
  }

  if(currentPage.includes('login.html')) {
    qs('#loginBtn')?.addEventListener('click', login);
    qs('#registerBtn')?.addEventListener('click', register);
    qs('#toggleToRegister')?.addEventListener('click', toggleForm);
    qs('#toggleToLogin')?.addEventListener('click', toggleForm);
  }
  
  if(currentPage.includes('documents.html')) {
    qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments);
    qs('#searchDocs')?.addEventListener('input', () => {
        const query = qs('#searchDocs').value.toLowerCase();
        const filtered = documents.filter(d => d.fileName.toLowerCase().includes(query));
        renderDocuments(filtered);
    });
  }
});

// Expose some functions for inline onclick handlers (Important)
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.openEditPageForOrder = openEditPageForOrder;
window.confirmAndDeleteOrder = confirmAndDeleteOrder;
window.openEditPageForSale = openEditPageForSale;
window.confirmAndDeleteSale = confirmAndDeleteSale;
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;
