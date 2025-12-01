// public/js/script.js
// Complete client-side script for Online Inventory & Documents System

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

// Utilities
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [];
let activityLog = [];
let documents = [];
let purchases = [];
let sales = [];
let folders = [];
let currentFolder = 'root';
let companyInfo = {};
const currentPage = window.location.pathname.split('/').pop();

// Enhanced theme persistence
function initializeTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.body.classList.toggle('dark-mode', savedTheme === 'dark');
  document.body.setAttribute('data-theme', savedTheme);
}

function toggleTheme(){
  const isDark = document.body.classList.toggle('dark-mode');
  const theme = isDark ? 'dark' : 'light';
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

// Fetch wrapper
async function apiFetch(url, options = {}) {
  const user = getUsername();
  options.headers = {
    'Content-Type': 'application/json',
    'X-Username': user,
    ...options.headers,
  };

  return fetch(url, options);
}

// Auth redirect
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  try { window.location.href = 'login.html'; } catch(e) {}
}

function logout(){
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('adminName');
  window.location.href = 'login.html';
}

// =========================================
// NEW: Company Information Management
// =========================================
async function fetchCompanyInfo() {
  try {
    const res = await apiFetch(`${API_BASE}/company`);
    if (res.ok) {
      companyInfo = await res.json();
      updateCompanyInfoDisplay();
    }
  } catch (err) {
    console.error('Fetch company info error:', err);
  }
}

async function updateCompanyInfo() {
  const name = qs('#companyName')?.value?.trim();
  const address = qs('#companyAddress')?.value?.trim();
  const phone = qs('#companyPhone')?.value?.trim();
  const email = qs('#companyEmail')?.value?.trim();

  if (!name || !address || !phone || !email) {
    alert('⚠️ Please fill in all company information fields.');
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/company`, {
      method: 'PUT',
      body: JSON.stringify({ name, address, phone, email })
    });

    if (res.ok) {
      alert('✅ Company information updated successfully!');
      await fetchCompanyInfo();
    } else {
      alert('❌ Failed to update company information.');
    }
  } catch (err) {
    console.error('Update company info error:', err);
    alert('❌ Server error while updating company information.');
  }
}

function updateCompanyInfoDisplay() {
  if (qs('#companyNameDisplay')) qs('#companyNameDisplay').textContent = companyInfo.name || 'L&B Company';
  if (qs('#companyAddressDisplay')) qs('#companyAddressDisplay').textContent = companyInfo.address || 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka';
  if (qs('#companyPhoneDisplay')) qs('#companyPhoneDisplay').textContent = companyInfo.phone || '01133127622';
  if (qs('#companyEmailDisplay')) qs('#companyEmailDisplay').textContent = companyInfo.email || 'lbcompany@gmail.com';
}

// =========================================
// INVENTORY MANAGEMENT FUNCTIONS
// =========================================
async function fetchInventory() {
  try {
    const res = await apiFetch(`${API_BASE}/inventory`);
    if(!res.ok) throw new Error('Failed to fetch inventory');
    const data = await res.json();
    inventory = data.map(i => ({ ...i, id: i.id || i._id }));
    renderInventory(inventory);
    renderDashboardData();
  } catch(err) { console.error(err); }
}

function renderInventory(items) {
  const list = qs('#inventoryList');
  if(!list) return;
  list.innerHTML = '';
  let totalValue = 0, totalRevenue = 0, totalProfit = 0, totalStock = 0;

  items.forEach(it => {
    const id = it.id || it._id;
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const invVal = qty * uc;
    const rev = qty * up;
    const profit = rev - invVal;
    
    totalValue += invVal;
    totalRevenue += rev;
    totalProfit += profit;
    totalStock += qty;

    const date = it.createdAt ? new Date(it.createdAt).toLocaleDateString() : 'N/A';

    const tr = document.createElement('tr');
    if(qty === 0) tr.classList.add('out-of-stock-row');
    else if(qty < 10) tr.classList.add('low-stock-row');

    tr.innerHTML = `
      <td>${escapeHtml(it.sku||'')}</td>
      <td>${escapeHtml(it.name||'')}</td>
      <td>${escapeHtml(it.category||'')}</td>
      <td>${qty}</td>
      <td class="money">RM ${uc.toFixed(2)}</td>
      <td class="money">RM ${up.toFixed(2)}</td>
      <td class="money">RM ${invVal.toFixed(2)}</td>
      <td class="money">RM ${rev.toFixed(2)}</td>
      <td class="money">RM ${profit.toFixed(2)}</td>
      <td>${date}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditPageForItem('${id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="confirmAndDeleteItem('${id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });

  // Update summary cards
  if(qs('#cardTotalValue')) qs('#cardTotalValue').textContent = `RM ${totalValue.toFixed(2)}`;
  if(qs('#cardTotalRevenue')) qs('#cardTotalRevenue').textContent = `RM ${totalRevenue.toFixed(2)}`;
  if(qs('#cardTotalProfit')) qs('#cardTotalProfit').textContent = `RM ${totalProfit.toFixed(2)}`;
  if(qs('#cardTotalStock')) qs('#cardTotalStock').textContent = totalStock;
  if(qs('#cardTotalProducts')) qs('#cardTotalProducts').textContent = items.length;
}

function searchInventory(){
  const textQuery = (qs('#searchInput')?.value || '').toLowerCase().trim();
  const startDate = qs('#startDate')?.value || '';
  const endDate = qs('#endDate')?.value || '';
  
  let filtered = inventory;
  
  // Apply text filter if exists
  if (textQuery) {
    filtered = filtered.filter(item => 
      (item.sku||'').toLowerCase().includes(textQuery) || 
      (item.name||'').toLowerCase().includes(textQuery) || 
      (item.category||'').toLowerCase().includes(textQuery)
    );
  }
  
  // Apply date range filter if exists
  if (startDate || endDate) {
    filtered = filtered.filter(item => {
      if (!item.createdAt) return false;
      const itemDate = new Date(item.createdAt);
      if (startDate && !endDate) return itemDate >= new Date(startDate);
      if (!startDate && endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return itemDate <= end;
      }
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return itemDate >= start && itemDate <= end;
      }
      return true;
    });
  }
  renderInventory(filtered);
}

// =========================================
// DATE RANGE FILTERING FUNCTIONS
// =========================================
function filterByDateRange(startDate, endDate) {
  if (!startDate && !endDate) {
    renderInventory(inventory);
    updateDateRangeStatus(false);
    return;
  }

  const filtered = inventory.filter(item => {
    if (!item.createdAt) return false;
    const itemDate = new Date(item.createdAt);
    if (startDate && !endDate) return itemDate >= new Date(startDate);
    if (!startDate && endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return itemDate <= end;
    }
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      return itemDate >= start && itemDate <= end;
    }
    return true;
  });
  
  renderInventory(filtered);
  updateDateRangeStatus(true, startDate, endDate);
}

function updateDateRangeStatus(isActive, startDate, endDate) {
  const dateRangeContainer = qs('.date-range-container');
  const statusElement = qs('.date-range-status') || createDateRangeStatusElement();
  
  if (isActive) {
    dateRangeContainer.classList.add('active');
    let statusText = 'Filtering by: ';
    if (startDate && endDate) statusText += `${formatDateDisplay(startDate)} to ${formatDateDisplay(endDate)}`;
    else if (startDate) statusText += `From ${formatDateDisplay(startDate)}`;
    else if (endDate) statusText += `Until ${formatDateDisplay(endDate)}`;
    statusElement.textContent = statusText;
    statusElement.classList.add('active');
  } else {
    dateRangeContainer.classList.remove('active');
    statusElement.classList.remove('active');
    statusElement.textContent = '';
  }
}

function createDateRangeStatusElement() {
  const statusElement = document.createElement('span');
  statusElement.className = 'date-range-status';
  qs('.date-range-container').appendChild(statusElement);
  return statusElement;
}

function formatDateDisplay(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function clearDateRangeFilter() {
  if (qs('#startDate')) qs('#startDate').value = '';
  if (qs('#endDate')) qs('#endDate').value = '';
  renderInventory(inventory);
  updateDateRangeStatus(false);
}

function applyDateRangeFilter() {
  const startDate = qs('#startDate')?.value;
  const endDate = qs('#endDate')?.value;
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start > end) { alert('❌ Start date cannot be after end date.'); return; }
  }
  filterByDateRange(startDate, endDate);
}

function bindDateRangeFilterEvents() {
  qs('#applyDateRangeBtn')?.addEventListener('click', applyDateRangeFilter);
  qs('#clearDateRangeBtn')?.addEventListener('click', clearDateRangeFilter);
  qs('#startDate')?.addEventListener('change', function() { if (qs('#endDate')?.value) applyDateRangeFilter(); });
  qs('#endDate')?.addEventListener('change', function() { if (qs('#startDate')?.value) applyDateRangeFilter(); });
}

// =========================================
// INVENTORY CRUD OPERATIONS
// =========================================
async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value?.trim();
  const name = qs('#p_name')?.value?.trim();
  const category = qs('#p_category')?.value?.trim();
  const quantity = Number(qs('#p_quantity')?.value || 0);
  const unitCost = Number(qs('#p_unitCost')?.value || 0);
  const unitPrice = Number(qs('#p_unitPrice')?.value || 0);
  if(!sku || !name) return alert('⚠️ Please enter SKU and Name.');
  if(!confirm(`Confirm Add Product: ${name} (${sku})?`)) return;

  const newItem = { sku, name, category, quantity, unitCost, unitPrice };
  try {
    const res = await apiFetch(`${API_BASE}/inventory`, { method: 'POST', body: JSON.stringify(newItem) });
    if(res.ok) {
      ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id => { if(qs(id)) qs(id).value = ''; });
      await fetchInventory();
      if(currentPage.includes('inventory')) await fetchLogs();
      alert('✅ Product added successfully.');
    } else {
      alert('❌ Failed to add product.');
    }
  } catch(e) { console.error(e); alert('❌ Server connection error while adding product.'); }
}

async function confirmAndDeleteItem(id){
  const it = inventory.find(x => String(x.id) === String(id));
  if(!it) return;
  if(!confirm(`Confirm Delete: "${it.name}"?`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method: 'DELETE' });
    if(res.status === 204) {
      await fetchInventory();
      alert('🗑️ Item deleted!');
    } else {
      alert('❌ Failed to delete item.');
    }
  } catch(e) { console.error(e); alert('❌ Server connection error while deleting product.'); }
}

function openEditPageForItem(id){ 
  window.location.href = `product.html?id=${encodeURIComponent(id)}`; 
}

// =========================================
// PRODUCT EDIT PAGE FUNCTIONS
// =========================================
async function bindProductPage(){
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if(id) {
    try {
      const res = await apiFetch(`${API_BASE}/inventory`);
      const items = await res.json();
      const it = items.find(x => String(x.id) === String(id));
      if(!it) { alert('Item not found'); return; }
      if(qs('#prod_id')) qs('#prod_id').value = it.id || it._id;
      if(qs('#prod_sku')) qs('#prod_sku').value = it.sku || '';
      if(qs('#prod_name')) qs('#prod_name').value = it.name || '';
      if(qs('#prod_category')) qs('#prod_category').value = it.category || '';
      if(qs('#prod_quantity')) qs('#prod_quantity').value = it.quantity || 0;
      if(qs('#prod_unitCost')) qs('#prod_unitCost').value = it.unitCost || 0;
      if(qs('#prod_unitPrice')) qs('#prod_unitPrice').value = it.unitPrice || 0;
    } catch(e) { alert('Failed to load product details.'); return; }
  }

  qs('#saveProductBtn')?.addEventListener('click', async ()=> {
    if(!confirm('Confirm: Save Changes?')) return;
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
      if(res.ok) { alert('✅ Item updated'); window.location.href = 'inventory.html'; }
      else { const err = await res.json(); alert('❌ Failed to update item: ' + (err.message || 'Unknown')); }
    } catch(e) { console.error(e); alert('❌ Server connection error during update.'); }
  });

  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href = 'inventory.html');
}

// =========================================
// SALES MANAGEMENT FUNCTIONS
// =========================================
async function fetchSales() {
  try {
    const res = await apiFetch(`${API_BASE}/sales`);
    if (!res.ok) throw new Error('Failed to fetch sales');
    const data = await res.json();
    sales = data.map(s => ({ ...s, id: s.id || s._id }));
    renderSalesHistory();
  } catch(err) { console.error('Fetch sales error:', err); }
}

function renderSalesHistory() {
  const list = qs('#salesHistoryList');
  if (!list) return;
  list.innerHTML = '';
  sales.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(s.salesId || 'N/A')}</td>
      <td>${escapeHtml(s.customer || '')}</td>
      <td>${s.items ? s.items.length : 0} items</td>
      <td class="money">RM ${(s.totalAmount || 0).toFixed(2)}</td>
      <td>${new Date(s.salesDate).toLocaleDateString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="viewSalesDetails('${s.id}')">👁️ View</button>
        <button class="danger-btn small-btn" onclick="deleteSales('${s.id}')">🗑️ Delete</button>
        <button class="success-btn small-btn" onclick="printSalesInvoice('${s.id}')">🖨️ Invoice</button>
      </td>
    `;
    list.appendChild(tr);
  });
}

function openSalesHistoryModal() {
  const modal = qs('#salesHistoryModal');
  if (modal) { modal.style.display = 'block'; fetchSales(); }
}

function closeSalesHistoryModal() {
  const modal = qs('#salesHistoryModal');
  if (modal) modal.style.display = 'none';
}

function openNewSalesModal() {
  const modal = qs('#newSalesModal');
  if (modal) {
    resetSalesForm();
    qs('#salesItems').innerHTML = '';
    loadProductSearchForSales();
    modal.style.display = 'block';
    updateSalesTotalAmount();
  }
}

function closeNewSalesModal() {
  const modal = qs('#newSalesModal');
  if (modal) { modal.style.display = 'none'; resetSalesForm(); }
}

function resetSalesForm() {
  qs('#customerName').value = '';
  qs('#salesDate').value = new Date().toISOString().split('T')[0];
  qs('#salesNotes').value = '';
  qs('#productSearchSales').value = '';
  qs('#productResultsSales').innerHTML = '';
  qs('#salesItems').innerHTML = '';
  qs('#totalSalesAmount').textContent = '0.00';
}

function addSalesProductItem(product = null) {
  const container = qs('#salesItems');
  const itemId = `sales-item-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  const itemRow = document.createElement('div');
  itemRow.className = 'sales-item-row';
  itemRow.id = itemId;
  const availableStock = product ? (product.quantity || 0) : 0;
  
  itemRow.innerHTML = `
    <div class="form-group"><label>SKU</label><input type="text" class="product-sku" placeholder="SKU" value="${product ? escapeHtml(product.sku || '') : ''}" ${product ? 'readonly' : ''}></div>
    <div class="form-group"><label>Product Name</label><input type="text" class="product-name" placeholder="Product Name" value="${product ? escapeHtml(product.name || '') : ''}" ${product ? 'readonly' : ''}></div>
    <div class="form-group"><label>Quantity (Stock: ${availableStock})</label><input type="number" class="product-quantity" placeholder="Qty" min="1" max="${availableStock}" value="1"></div>
    <div class="form-group"><label>Sale Price (RM)</label><input type="number" class="product-price" placeholder="Price" step="0.01" min="0" value="${product ? (product.unitPrice || '0.00') : '0.00'}"></div>
    <div class="form-group"><label>Total (RM)</label><input type="text" class="product-total" placeholder="Total" readonly value="0.00"></div>
    <button class="danger-btn remove-item-btn" type="button" title="Remove Item">🗑️</button>
  `;
  
  container.appendChild(itemRow);
  const quantityInput = itemRow.querySelector('.product-quantity');
  const priceInput = itemRow.querySelector('.product-price');
  const totalInput = itemRow.querySelector('.product-total');
  
  const calculateTotal = () => {
    const qty = Number(quantityInput.value) || 0;
    const price = Number(priceInput.value) || 0;
    totalInput.value = (qty * price).toFixed(2);
    updateSalesTotalAmount();
  };
  
  quantityInput.addEventListener('input', calculateTotal);
  priceInput.addEventListener('input', calculateTotal);
  itemRow.querySelector('.remove-item-btn').addEventListener('click', () => { itemRow.remove(); updateSalesTotalAmount(); });
  calculateTotal();
}

function updateSalesTotalAmount() {
  let total = 0;
  qsa('#salesItems .sales-item-row').forEach(row => {
    total += Number(row.querySelector('.product-total').value) || 0;
  });
  qs('#totalSalesAmount').textContent = total.toFixed(2);
}

function loadProductSearchForSales() {
  const searchInput = qs('#productSearchSales');
  const resultsContainer = qs('#productResultsSales');
  if (searchInput && resultsContainer) {
    searchInput.addEventListener('input', function() {
      const query = this.value.toLowerCase().trim();
      resultsContainer.innerHTML = '';
      if (query.length < 2) return;
      const filtered = inventory.filter(item => 
        (item.sku && item.sku.toLowerCase().includes(query)) ||
        (item.name && item.name.toLowerCase().includes(query))
      );
      if (filtered.length === 0) { resultsContainer.innerHTML = '<div class="product-result-item">No products found</div>'; return; }
      filtered.forEach(item => {
        const div = document.createElement('div');
        div.className = 'product-result-item';
        div.innerHTML = `<div class="sku">${escapeHtml(item.sku||'N/A')}</div><div class="name">${escapeHtml(item.name||'N/A')}</div><div class="stock">Stock: ${item.quantity||0} | Price: RM ${(item.unitPrice||0).toFixed(2)}</div>`;
        div.addEventListener('click', () => { addSalesProductItem(item); searchInput.value = ''; resultsContainer.innerHTML = ''; });
        resultsContainer.appendChild(div);
      });
    });
  }
}

async function saveSalesOrder() {
  const customer = qs('#customerName').value.trim();
  const salesDate = qs('#salesDate').value;
  const notes = qs('#salesNotes').value.trim();
  if (!customer) return alert('⚠️ Please enter customer name.');
  const itemRows = qsa('.sales-item-row');
  if (itemRows.length === 0) return alert('⚠️ Please add at least one product item.');
  
  const items = [];
  for (const row of itemRows) {
    const sku = row.querySelector('.product-sku').value.trim();
    const productName = row.querySelector('.product-name').value.trim();
    const quantity = Number(row.querySelector('.product-quantity').value);
    const salePrice = Number(row.querySelector('.product-price').value);
    if (!sku || !productName || quantity <= 0 || salePrice <= 0) return alert('⚠️ Invalid item fields.');
    
    // Check stock
    const invItem = inventory.find(i => i.sku === sku);
    if(invItem && invItem.quantity < quantity) return alert(`❌ Insufficient stock for ${productName}. Available: ${invItem.quantity}`);
    
    items.push({ sku, productName, quantity, salePrice });
  }
  
  if (!confirm(`Confirm Sales Order for ${customer}?`)) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/sales`, { method: 'POST', body: JSON.stringify({ customer, salesDate, notes, items }) });
    if (res.ok) {
      alert('✅ Sales order saved successfully!');
      closeNewSalesModal();
      await fetchInventory();
      await fetchSales();
    } else {
      const err = await res.json();
      alert(`❌ Failed: ${err.message}`);
    }
  } catch (e) { console.error(e); alert('❌ Server connection error.'); }
}

async function viewSalesDetails(salesId) {
  try {
    const res = await apiFetch(`${API_BASE}/sales/${salesId}`);
    if (!res.ok) throw new Error('Failed to fetch sales details');
    const sale = await res.json();
    qs('#detailSalesId').textContent = sale.salesId || 'N/A';
    qs('#detailCustomer').textContent = sale.customer || 'N/A';
    qs('#detailSalesDate').textContent = new Date(sale.salesDate).toLocaleDateString();
    qs('#detailSalesTotalAmount').textContent = `RM ${(sale.totalAmount || 0).toFixed(2)}`;
    qs('#detailSalesNotes').textContent = sale.notes || '';
    
    const itemsList = qs('#salesDetailsList');
    itemsList.innerHTML = '';
    sale.items.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(item.sku)}</td><td>${escapeHtml(item.productName)}</td><td>${item.quantity}</td><td class="money">RM ${(item.salePrice||0).toFixed(2)}</td><td class="money">RM ${(item.totalAmount||0).toFixed(2)}</td>`;
      itemsList.appendChild(tr);
    });
    qs('#printSalesInvoiceBtn').onclick = () => printSalesInvoice(salesId);
    qs('#salesDetailsModal').style.display = 'block';
  } catch (e) { console.error(e); alert('❌ Failed to load sales details.'); }
}

function closeSalesDetailsModal() { qs('#salesDetailsModal').style.display = 'none'; }

async function deleteSales(id) {
  const sale = sales.find(s => String(s.id) === String(id));
  if (!sale) return;
  if (!confirm(`Confirm Delete Sales Order ${sale.salesId}? Stock will be reverted.`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/sales/${id}`, { method: 'DELETE' });
    if (res.status === 204) { await fetchSales(); await fetchInventory(); alert('🗑️ Sales order deleted!'); }
    else alert('❌ Failed to delete.');
  } catch (e) { alert('❌ Server error.'); }
}

async function printSalesInvoice(salesId) {
  try {
    const res = await fetch(`${API_BASE}/sales/invoice/${salesId}`);
    if (!res.ok) throw new Error('Failed to generate invoice');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Invoice_${salesId}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  } catch (e) { console.error(e); alert('❌ Failed to generate invoice.'); }
}

// =========================================
// PURCHASE MANAGEMENT FUNCTIONS
// =========================================
async function fetchPurchases() {
  try {
    const res = await apiFetch(`${API_BASE}/purchases`);
    if (!res.ok) throw new Error('Failed to fetch purchases');
    const data = await res.json();
    purchases = data.map(p => ({ ...p, id: p.id || p._id }));
    renderPurchaseHistory();
  } catch(err) { console.error(err); }
}

function renderPurchaseHistory() {
  const list = qs('#purchaseHistoryList');
  if (!list) return;
  list.innerHTML = '';
  purchases.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(p.purchaseId || 'N/A')}</td>
      <td>${escapeHtml(p.supplier || '')}</td>
      <td>${p.items ? p.items.length : 0} items</td>
      <td class="money">RM ${(p.totalAmount || 0).toFixed(2)}</td>
      <td>${new Date(p.purchaseDate).toLocaleDateString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="viewPurchaseDetails('${p.id}')">👁️ View</button>
        <button class="danger-btn small-btn" onclick="deletePurchase('${p.id}')">🗑️ Delete</button>
        <button class="success-btn small-btn" onclick="printPurchaseInvoice('${p.id}')">🖨️ Invoice</button>
      </td>
    `;
    list.appendChild(tr);
  });
}

function openPurchaseHistoryModal() {
  const modal = qs('#purchaseHistoryModal');
  if (modal) { modal.style.display = 'block'; fetchPurchases(); }
}

function closePurchaseHistoryModal() {
  const modal = qs('#purchaseHistoryModal');
  if (modal) modal.style.display = 'none';
}

function openNewPurchaseModal() {
  const modal = qs('#newPurchaseModal');
  if (modal) {
    resetPurchaseForm();
    qs('#purchaseItems').innerHTML = '';
    loadProductSearch();
    modal.style.display = 'block';
    updateTotalAmount();
  }
}

function closeNewPurchaseModal() {
  const modal = qs('#newPurchaseModal');
  if (modal) { modal.style.display = 'none'; resetPurchaseForm(); }
}

function resetPurchaseForm() {
  qs('#supplierName').value = '';
  qs('#purchaseDate').value = new Date().toISOString().split('T')[0];
  qs('#purchaseNotes').value = '';
  qs('#productSearch').value = '';
  qs('#productResults').innerHTML = '';
  qs('#purchaseItems').innerHTML = '';
  if (qs('#totalPurchaseAmount')) qs('#totalPurchaseAmount').textContent = '0.00';
}

function addProductItem(product = null) {
  const container = qs('#purchaseItems');
  const itemId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  const itemRow = document.createElement('div');
  itemRow.className = 'purchase-item-row';
  itemRow.id = itemId;
  
  itemRow.innerHTML = `
    <div class="form-group"><label>SKU</label><input type="text" class="product-sku" placeholder="SKU" value="${product ? escapeHtml(product.sku || '') : ''}" ${product ? 'readonly' : ''}></div>
    <div class="form-group"><label>Product Name</label><input type="text" class="product-name" placeholder="Product Name" value="${product ? escapeHtml(product.name || '') : ''}" ${product ? 'readonly' : ''}></div>
    <div class="form-group"><label>Quantity</label><input type="number" class="product-quantity" placeholder="Qty" min="1" value="1"></div>
    <div class="form-group"><label>Unit Price (RM)</label><input type="number" class="product-price" placeholder="Price" step="0.01" min="0" value="${product ? (product.unitCost || '0.00') : '0.00'}"></div>
    <div class="form-group"><label>Total (RM)</label><input type="text" class="product-total" placeholder="Total" readonly value="0.00"></div>
    <button class="danger-btn remove-item-btn" type="button" title="Remove Item">🗑️</button>
  `;
  container.appendChild(itemRow);
  
  const quantityInput = itemRow.querySelector('.product-quantity');
  const priceInput = itemRow.querySelector('.product-price');
  const totalInput = itemRow.querySelector('.product-total');
  
  const calculateTotal = () => {
    const qty = Number(quantityInput.value) || 0;
    const price = Number(priceInput.value) || 0;
    totalInput.value = (qty * price).toFixed(2);
    updateTotalAmount();
  };
  
  quantityInput.addEventListener('input', calculateTotal);
  priceInput.addEventListener('input', calculateTotal);
  itemRow.querySelector('.remove-item-btn').addEventListener('click', () => { itemRow.remove(); updateTotalAmount(); });
  calculateTotal();
}

function updateTotalAmount() {
  let total = 0;
  qsa('#purchaseItems .purchase-item-row').forEach(row => {
    total += Number(row.querySelector('.product-total').value) || 0;
  });
  if (qs('#totalPurchaseAmount')) qs('#totalPurchaseAmount').textContent = total.toFixed(2);
}

function loadProductSearch() {
  const searchInput = qs('#productSearch');
  const resultsContainer = qs('#productResults');
  if (searchInput && resultsContainer) {
    searchInput.addEventListener('input', function() {
      const query = this.value.toLowerCase().trim();
      resultsContainer.innerHTML = '';
      if (query.length < 2) return;
      const filtered = inventory.filter(item => 
        (item.sku && item.sku.toLowerCase().includes(query)) ||
        (item.name && item.name.toLowerCase().includes(query))
      );
      if (filtered.length === 0) { resultsContainer.innerHTML = '<div class="product-result-item">No products found</div>'; return; }
      filtered.forEach(item => {
        const div = document.createElement('div');
        div.className = 'product-result-item';
        div.innerHTML = `<div class="sku">${escapeHtml(item.sku||'N/A')}</div><div class="name">${escapeHtml(item.name||'N/A')}</div><div class="stock">Stock: ${item.quantity||0} | Cost: RM ${(item.unitCost||0).toFixed(2)}</div>`;
        div.addEventListener('click', () => { addProductItem(item); searchInput.value = ''; resultsContainer.innerHTML = ''; });
        resultsContainer.appendChild(div);
      });
    });
  }
}

async function savePurchaseOrder() {
  const supplier = qs('#supplierName').value.trim();
  const purchaseDate = qs('#purchaseDate').value;
  const notes = qs('#purchaseNotes').value.trim();
  if (!supplier) return alert('⚠️ Please enter supplier name.');
  const itemRows = qsa('.purchase-item-row');
  if (itemRows.length === 0) return alert('⚠️ Please add at least one product item.');
  
  const items = [];
  for (const row of itemRows) {
    const sku = row.querySelector('.product-sku').value.trim();
    const productName = row.querySelector('.product-name').value.trim();
    const quantity = Number(row.querySelector('.product-quantity').value);
    const purchasePrice = Number(row.querySelector('.product-price').value);
    if (!sku || !productName || quantity <= 0 || purchasePrice <= 0) return alert('⚠️ Invalid item fields.');
    items.push({ sku, productName, quantity, purchasePrice });
  }
  
  if (!confirm(`Confirm Purchase Order from ${supplier}?`)) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/purchases`, { method: 'POST', body: JSON.stringify({ supplier, purchaseDate, notes, items }) });
    if (res.ok) {
      alert('✅ Purchase order saved successfully!');
      closeNewPurchaseModal();
      await fetchInventory();
      await fetchPurchases();
    } else {
      const err = await res.json();
      alert(`❌ Failed: ${err.message}`);
    }
  } catch (e) { console.error(e); alert('❌ Server connection error.'); }
}

async function viewPurchaseDetails(purchaseId) {
  try {
    const res = await apiFetch(`${API_BASE}/purchases/${purchaseId}`);
    if (!res.ok) throw new Error('Failed to fetch details');
    const purchase = await res.json();
    qs('#detailPurchaseId').textContent = purchase.purchaseId || 'N/A';
    qs('#detailSupplier').textContent = purchase.supplier || 'N/A';
    qs('#detailPurchaseDate').textContent = new Date(purchase.purchaseDate).toLocaleDateString();
    qs('#detailTotalAmount').textContent = `RM ${(purchase.totalAmount||0).toFixed(2)}`;
    qs('#detailNotes').textContent = purchase.notes || '';
    
    const itemsList = qs('#purchaseDetailsList');
    itemsList.innerHTML = '';
    purchase.items.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(item.sku)}</td><td>${escapeHtml(item.productName)}</td><td>${item.quantity}</td><td class="money">RM ${(item.purchasePrice||0).toFixed(2)}</td><td class="money">RM ${(item.totalAmount||0).toFixed(2)}</td>`;
      itemsList.appendChild(tr);
    });
    qs('#printDetailsInvoiceBtn').onclick = () => printPurchaseInvoice(purchaseId);
    qs('#purchaseDetailsModal').style.display = 'block';
  } catch (e) { console.error(e); alert('❌ Failed to load details.'); }
}

function closePurchaseDetailsModal() { qs('#purchaseDetailsModal').style.display = 'none'; }

async function deletePurchase(id) {
  const purchase = purchases.find(p => String(p.id) === String(id));
  if (!purchase) return;
  if (!confirm(`Confirm Delete Purchase Order ${purchase.purchaseId}? Stock will be reverted.`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/purchases/${id}`, { method: 'DELETE' });
    if (res.status === 204) { await fetchPurchases(); await fetchInventory(); alert('🗑️ Purchase order deleted!'); }
    else alert('❌ Failed to delete.');
  } catch (e) { alert('❌ Server error.'); }
}

async function printPurchaseInvoice(purchaseId) {
  try {
    const res = await fetch(`${API_BASE}/purchases/invoice/${purchaseId}`);
    if (!res.ok) throw new Error('Failed to generate invoice');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Invoice_${purchaseId}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  } catch (e) { console.error(e); alert('❌ Failed to generate invoice.'); }
}

// =========================================
// REPORT GENERATION
// =========================================
function openReportModal() {
  const modal = qs('#reportModal');
  if (modal) {
    modal.style.display = 'block';
    const today = new Date();
    qs('#reportStartDate').value = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    qs('#reportEndDate').value = today.toISOString().split('T')[0];
    qsa('.report-option').forEach(opt => opt.classList.remove('selected'));
  }
}

function closeReportModal() { qs('#reportModal').style.display = 'none'; }

function selectReportType(type) {
  qsa('.report-option').forEach(opt => opt.classList.remove('selected'));
  qs(`#report-${type}`).classList.add('selected');
  qs('#selectedReportType').value = type;
}

async function generateSelectedReport() {
  const reportType = qs('#selectedReportType').value;
  const startDate = qs('#reportStartDate').value;
  const endDate = qs('#reportEndDate').value;
  
  if (!reportType) return alert('⚠️ Please select a report type.');
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) return alert('❌ Start date cannot be after end date.');
  
  closeReportModal();
  if (reportType === 'all') await generateAllReports(startDate, endDate);
  else await generateSingleReport(reportType, startDate, endDate);
}

async function generateSingleReport(type, startDate, endDate) {
  let endpoint = '';
  if (type === 'inventory') endpoint = '/inventory/report/pdf';
  else if (type === 'purchase') endpoint = '/purchases/report/pdf';
  else if (type === 'sales') endpoint = '/sales/report/pdf';
  
  try {
    const res = await apiFetch(`${API_BASE}${endpoint}`, { method: 'POST', body: JSON.stringify({ startDate, endDate }) });
    if (!res.ok) throw new Error('Failed');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}_Report_${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    alert(`✅ ${type.charAt(0).toUpperCase() + type.slice(1)} Report Generated!`);
  } catch (e) { console.error(e); alert(`❌ Failed to generate ${type} report.`); }
}

async function generateAllReports(startDate, endDate) {
  if (!confirm('Generate All Reports?')) return;
  try {
    await generateSingleReport('inventory', startDate, endDate);
    await generateSingleReport('purchase', startDate, endDate);
    await generateSingleReport('sales', startDate, endDate);
    alert('✅ All Reports Generated Successfully!');
  } catch (e) { alert('❌ Failed to generate some reports.'); }
}

// =========================================
// FOLDER MANAGEMENT
// =========================================
async function fetchFolders() {
  try {
    const res = await apiFetch(`${API_BASE}/folders`);
    if (res.ok) { folders = await res.json(); renderFolders(); }
  } catch (err) { console.error(err); }
}

function renderFolders() {
  const folderList = qs('#folderList');
  if (!folderList) return;
  folderList.innerHTML = '';
  const currentFolders = folders.filter(folder => 
    (currentFolder === 'root' && !folder.parentFolder) || (currentFolder !== 'root' && folder.parentFolder === currentFolder)
  );
  currentFolders.forEach(folder => {
    const div = document.createElement('div');
    div.className = 'folder-item';
    div.innerHTML = `
      <div class="folder-icon">📁</div><div class="folder-name">${escapeHtml(folder.name)}</div>
      <div class="folder-actions"><button class="secondary-btn small-btn" onclick="renameFolder('${folder.id}')">✏️</button><button class="danger-btn small-btn" onclick="deleteFolder('${folder.id}')">🗑️</button></div>
    `;
    div.addEventListener('click', (e) => { if (!e.target.closest('.folder-actions')) navigateToFolder(folder.id); });
    folderList.appendChild(div);
  });
}

function navigateToFolder(folderId) {
  currentFolder = folderId;
  updateBreadcrumb();
  fetchDocuments();
  renderFolders();
}

function updateBreadcrumb() {
  const breadcrumb = qs('#folderBreadcrumb');
  if (!breadcrumb) return;
  breadcrumb.innerHTML = '';
  const rootItem = document.createElement('div');
  rootItem.className = `breadcrumb-item ${currentFolder === 'root' ? 'active' : ''}`;
  rootItem.textContent = 'Root';
  rootItem.addEventListener('click', () => navigateToFolder('root'));
  breadcrumb.appendChild(rootItem);
  if (currentFolder !== 'root') {
    const folder = folders.find(f => f.id === currentFolder);
    if (folder) {
      const pathItem = document.createElement('div');
      pathItem.className = 'breadcrumb-item active';
      pathItem.textContent = folder.name;
      breadcrumb.appendChild(pathItem);
    }
  }
}

async function createFolder() {
  const name = prompt('Enter folder name:');
  if (!name) return;
  try {
    const res = await apiFetch(`${API_BASE}/folders`, { method: 'POST', body: JSON.stringify({ name, parentFolder: currentFolder === 'root' ? null : currentFolder }) });
    if (res.ok) { await fetchFolders(); alert('✅ Folder created!'); }
    else alert('❌ Failed to create folder.');
  } catch (err) { alert('❌ Server error.'); }
}

async function renameFolder(id) {
  const folder = folders.find(f => f.id === id);
  const name = prompt('New folder name:', folder.name);
  if (!name) return;
  try {
    const res = await apiFetch(`${API_BASE}/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
    if (res.ok) { await fetchFolders(); alert('✅ Folder renamed!'); }
  } catch (e) { alert('❌ Error renaming folder.'); }
}

async function deleteFolder(id) {
  if (!confirm('Delete folder?')) return;
  try {
    const res = await apiFetch(`${API_BASE}/folders/${id}`, { method: 'DELETE' });
    if (res.status === 204) { await fetchFolders(); if(currentFolder === id) navigateToFolder('root'); alert('✅ Folder deleted!'); }
    else { const e = await res.json(); alert(`❌ ${e.message}`); }
  } catch (e) { alert('❌ Error deleting folder.'); }
}

// =========================================
// DOCUMENT MANAGEMENT
// =========================================
async function fetchDocuments() {
  try {
    const url = currentFolder === 'root' ? `${API_BASE}/documents` : `${API_BASE}/documents?folder=${currentFolder}`;
    const res = await apiFetch(url);
    if (!res.ok) throw new Error('Failed');
    documents = await res.json();
    renderDocuments(documents);
  } catch(err) { console.error(err); }
}

function renderDocuments(docs) {
  const list = qs('#docList');
  if(!list) return;
  list.innerHTML = '';
  docs.forEach(d => {
    const sizeMB = ((d.sizeBytes || d.size || 0) / (1024*1024)).toFixed(2);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(d.name||'')}</td><td>${sizeMB} MB</td><td>${new Date(d.date).toLocaleString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="downloadDocument('${d.id}', '${escapeHtml(d.name)}')">⬇️ Download</button>
        <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${d.id}')">🗑️ Delete</button>
        <button class="info-btn small-btn" onclick="previewDocument('${d.id}', '${escapeHtml(d.name)}')">👁️ Preview</button>
      </td>
    `;
    list.appendChild(tr);
  });
}

async function uploadDocuments(){
  const fileInput = qs('#docUpload');
  const files = fileInput?.files;
  if(!files || files.length === 0) return alert('⚠️ Select a file.');
  const file = files[0];
  if(file.size > 50*1024*1024) return alert('⚠️ File too large (>50MB).');
  
  try {
    const buf = await file.arrayBuffer();
    const res = await fetch(`${API_BASE}/documents`, { 
        method: 'POST', 
        body: new Uint8Array(buf),
        headers: {
            'Content-Type': file.type || 'application/octet-stream', 
            'X-Username': getUsername(),
            'X-File-Name': encodeURIComponent(file.name),
            'X-Folder-Id': currentFolder === 'root' ? '' : currentFolder
        }
    });
    if(res.ok) { alert('✅ Upload successful!'); await fetchDocuments(); fileInput.value = ''; }
    else alert('❌ Upload failed.');
  } catch(e) { console.error(e); alert('❌ Upload error.'); }
}

function previewDocument(docId, docName) {
  const modal = qs('#previewModal');
  const iframe = qs('#previewIframe');
  const title = qs('#previewTitle');
  if (modal && iframe) {
    title.textContent = `Preview: ${docName}`;
    iframe.src = `${API_BASE}/documents/preview/${docId}`;
    modal.style.display = 'block';
  }
}

function closePreviewModal() {
  const modal = qs('#previewModal');
  if (modal) { modal.style.display = 'none'; qs('#previewIframe').src = ''; }
}

async function downloadDocument(docId, fileName) {
  try {
    const res = await fetch(`${API_BASE}/documents/download/${docId}`);
    if(!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  } catch (e) { alert('❌ Download failed.'); }
}

async function deleteDocumentConfirm(id) {
  if(!confirm('Delete document?')) return;
  try {
    const res = await apiFetch(`${API_BASE}/documents/${id}`, { method: 'DELETE' });
    if(res.ok) { await fetchDocuments(); alert('🗑️ Deleted!'); }
  } catch(e) { alert('❌ Error deleting.'); }
}

function searchDocuments() {
  const q = (qs('#searchDocs')?.value || '').toLowerCase().trim();
  const filtered = documents.filter(d => (d.name||'').toLowerCase().includes(q));
  renderDocuments(filtered);
}

// =========================================
// STATEMENTS MANAGEMENT (FIXED)
// =========================================
async function openStatementsModal() {
  const modal = qs('#statementsModal');
  if (modal) {
    modal.style.display = 'block';
    await loadStatementsSummary();
    switchTab('inventory-reports'); // Default tab
  }
}

function closeStatementsModal() { qs('#statementsModal').style.display = 'none'; }

async function loadStatementsSummary() {
  try {
    const res = await apiFetch(`${API_BASE}/statements-summary`);
    if (res.ok) {
      const summary = (await res.json()).summary;
      // Update badge counts
      if (qs('#inventoryReportsCount')) qs('#inventoryReportsCount').textContent = summary.inventoryReports;
      if (qs('#purchaseInvoicesCount')) qs('#purchaseInvoicesCount').textContent = summary.purchaseInvoices;
      if (qs('#salesInvoicesCount')) qs('#salesInvoicesCount').textContent = summary.salesInvoices;
      if (qs('#purchaseReportsCount')) qs('#purchaseReportsCount').textContent = summary.purchaseReports;
      if (qs('#salesReportsCount')) qs('#salesReportsCount').textContent = summary.salesReports;
      if (qs('#totalReportsCount')) qs('#totalReportsCount').textContent = summary.totalReports;
      if (qs('#totalInvoicesCount')) qs('#totalInvoicesCount').textContent = summary.totalInvoices;
      
      // Update overall stats
      if (qs('#totalDocumentsCount')) qs('#totalDocumentsCount').textContent = summary.totalDocuments;
    }
  } catch (err) { console.error(err); }
}

async function switchTab(tabName) {
  // UI toggle
  qsa('.tab-button').forEach(btn => btn.classList.remove('active'));
  qs(`#tab-${tabName}`).classList.add('active');
  qsa('.tab-content').forEach(content => content.classList.remove('active'));
  qs(`#content-${tabName}`).classList.add('active');
  
  await loadStatements(tabName);
}

async function loadStatements(type) {
  try {
    const res = await apiFetch(`${API_BASE}/statements/${type}`);
    if (res.ok) {
      const data = await res.json();
      renderStatements(type, data.documents || []);
    }
  } catch (err) { console.error(err); }
}

function renderStatements(type, statements) {
  // Map tab name to list ID based on conventions
  let containerId = '';
  if (type === 'inventory-reports') containerId = '#inventoryReportsList';
  else if (type === 'purchase-invoices') containerId = '#purchaseInvoicesList';
  else if (type === 'sales-invoices') containerId = '#salesInvoicesList';
  else if (type === 'purchase-reports') containerId = '#purchaseReportsList';
  else if (type === 'sales-reports') containerId = '#salesReportsList';
  else if (type === 'all-reports') containerId = '#allReportsList';
  else if (type === 'all-invoices') containerId = '#allInvoicesList';

  const container = qs(containerId);
  if (!container) return;
  
  container.innerHTML = '';
  if (statements.length === 0) {
    container.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No documents found</td></tr>';
    return;
  }
  
  statements.forEach(doc => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(doc.name)}</td>
      <td>${((doc.size || 0) / (1024*1024)).toFixed(2)} MB</td>
      <td>${new Date(doc.date).toLocaleString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="previewDocument('${doc.id}', '${escapeHtml(doc.name)}')">👁️ Preview</button>
        <button class="success-btn small-btn" onclick="downloadDocument('${doc.id}', '${escapeHtml(doc.name)}')">⬇️ Download</button>
        <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${doc.id}')">🗑️ Delete</button>
      </td>
    `;
    container.appendChild(tr);
  });
}

// =========================================
// LOGS AND DASHBOARD
// =========================================
async function fetchLogs() {
  try {
    const res = await apiFetch(`${API_BASE}/logs`);
    if(res.ok) { activityLog = await res.json(); renderLogs(); renderDashboardData(); }
  } catch(err) { console.error(err); }
}

function renderLogs() {
  const list = qs('#logList');
  if (!list) return;
  list.innerHTML = "";
  activityLog.forEach(log => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(log.user)}</td><td>${escapeHtml(log.action)}</td><td>${new Date(log.time).toLocaleString()}</td>`;
    list.appendChild(tr);
  });
}

function renderDashboardData(){
  const tbody = qs('#recentActivities');
  if(tbody) {
    tbody.innerHTML = '';
    activityLog.slice(0,5).forEach(l => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(l.user||'Admin')}</td><td>${escapeHtml(l.action)}</td><td>${new Date(l.time).toLocaleString()}</td>`;
      tbody.appendChild(tr);
    });
  }
  if(qs('#dash_totalItems')) qs('#dash_totalItems').textContent = inventory.length;
}

// =========================================
// AUTH
// =========================================
async function login(){
  const user = qs('#username')?.value?.trim();
  const pass = qs('#password')?.value?.trim();
  if(!user || !pass) return alert('Enter credentials');
  try {
    const res = await apiFetch(`${API_BASE}/login`, { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
    if(res.ok) {
      sessionStorage.setItem('isLoggedIn', 'true');
      sessionStorage.setItem('adminName', user);
      window.location.href = 'inventory.html';
    } else alert('Login failed');
  } catch(e) { alert('Server error'); }
}

// =========================================
// INITIALIZATION
// =========================================
window.addEventListener('load', async () => {
  initializeTheme();
  if(qs('#adminName')) qs('#adminName').textContent = getUsername();
  await fetchCompanyInfo();
  
  if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
  if(currentPage.includes('documents')) { await fetchFolders(); await fetchDocuments(); bindDocumentsUI(); }
  if(currentPage.includes('log') || currentPage === '' || currentPage === 'index.html') { await fetchLogs(); await fetchInventory(); }
  if(currentPage.includes('product')) bindProductPage();
});

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', openReportModal);
  qs('#statementsBtn')?.addEventListener('click', openStatementsModal);
  qs('#searchInput')?.addEventListener('input', searchInventory);
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { if(qs('#searchInput')) { qs('#searchInput').value=''; searchInventory(); } });
  
  // Modals
  qs('#purchaseHistoryBtn')?.addEventListener('click', openPurchaseHistoryModal);
  qs('#newPurchaseBtn')?.addEventListener('click', openNewPurchaseModal);
  qs('#addProductItem')?.addEventListener('click', () => addProductItem());
  qs('#savePurchaseBtn')?.addEventListener('click', savePurchaseOrder);
  qs('#closePurchaseModal')?.addEventListener('click', closeNewPurchaseModal);
  
  qs('#salesHistoryBtn')?.addEventListener('click', openSalesHistoryModal);
  qs('#newSalesBtn')?.addEventListener('click', openNewSalesModal);
  qs('#addSalesProductItem')?.addEventListener('click', () => addSalesProductItem());
  qs('#saveSalesBtn')?.addEventListener('click', saveSalesOrder);
  qs('#closeSalesModal')?.addEventListener('click', closeNewSalesModal);
  
  qs('#generateReportBtn')?.addEventListener('click', generateSelectedReport);
  qs('#closeReportModal')?.addEventListener('click', closeReportModal);
  qs('#closeStatementsModal')?.addEventListener('click', closeStatementsModal);
  
  qsa('.close').forEach(btn => btn.addEventListener('click', function() { this.closest('.modal').style.display = 'none'; }));
  bindDateRangeFilterEvents();
}

function bindDocumentsUI(){
  qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments);
  qs('#searchDocs')?.addEventListener('input', searchDocuments);
  qs('#createFolderBtn')?.addEventListener('click', createFolder);
  qs('#navigateToRoot')?.addEventListener('click', () => navigateToFolder('root'));
  qsa('.close').forEach(btn => btn.addEventListener('click', function() { this.closest('.modal').style.display = 'none'; }));
}

// Global Exports
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;
window.previewDocument = previewDocument;
window.closePreviewModal = closePreviewModal;
window.openPurchaseHistoryModal = openPurchaseHistoryModal;
window.openNewPurchaseModal = openNewPurchaseModal;
window.viewPurchaseDetails = viewPurchaseDetails;
window.deletePurchase = deletePurchase;
window.printPurchaseInvoice = printPurchaseInvoice;
window.openSalesHistoryModal = openSalesHistoryModal;
window.openNewSalesModal = openNewSalesModal;
window.viewSalesDetails = viewSalesDetails;
window.deleteSales = deleteSales;
window.printSalesInvoice = printSalesInvoice;
window.openReportModal = openReportModal;
window.selectReportType = selectReportType;
window.openStatementsModal = openStatementsModal;
window.switchTab = switchTab;
window.createFolder = createFolder;
window.renameFolder = renameFolder;
window.deleteFolder = deleteFolder;
window.navigateToFolder = navigateToFolder;
window.login = login;
window.logout = logout;
window.toggleTheme = toggleTheme;
