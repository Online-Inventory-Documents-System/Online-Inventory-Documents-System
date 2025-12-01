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
      
      // If only start date is provided, filter items from that date forward
      if (startDate && !endDate) {
        const start = new Date(startDate);
        return itemDate >= start;
      }
      
      // If only end date is provided, filter items up to that date
      if (!startDate && endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999); // Include the entire end date
        return itemDate <= end;
      }
      
      // If both dates are provided, filter items within the range
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999); // Include the entire end date
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
    
    // If only start date is provided, filter items from that date forward
    if (startDate && !endDate) {
      const start = new Date(startDate);
      return itemDate >= start;
    }
    
    // If only end date is provided, filter items up to that date
    if (!startDate && endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999); // Include the entire end date
      return itemDate <= end;
    }
    
    // If both dates are provided, filter items within the range
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999); // Include the entire end date
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
    if (startDate && endDate) {
      statusText += `${formatDateDisplay(startDate)} to ${formatDateDisplay(endDate)}`;
    } else if (startDate) {
      statusText += `From ${formatDateDisplay(startDate)}`;
    } else if (endDate) {
      statusText += `Until ${formatDateDisplay(endDate)}`;
    }
    
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
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
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
  
  // Validate date range
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start > end) {
      alert('❌ Start date cannot be after end date.');
      return;
    }
  }
  
  filterByDateRange(startDate, endDate);
}

function bindDateRangeFilterEvents() {
  // Apply date range button event
  qs('#applyDateRangeBtn')?.addEventListener('click', applyDateRangeFilter);
  
  // Clear date range button event
  qs('#clearDateRangeBtn')?.addEventListener('click', clearDateRangeFilter);
  
  // Auto-apply when both dates are selected
  qs('#startDate')?.addEventListener('change', function() {
    if (qs('#endDate')?.value) {
      applyDateRangeFilter();
    }
  });
  
  qs('#endDate')?.addEventListener('change', function() {
    if (qs('#startDate')?.value) {
      applyDateRangeFilter();
    }
  });
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
// NEW: Sales Management Functions
// =========================================
async function fetchSales() {
  try {
    const res = await apiFetch(`${API_BASE}/sales`);
    if (!res.ok) throw new Error('Failed to fetch sales');
    const data = await res.json();
    sales = data.map(s => ({ ...s, id: s.id || s._id }));
    renderSalesHistory();
  } catch(err) {
    console.error('Fetch sales error:', err);
  }
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
        <button class="secondary-btn small-btn" onclick="editSalesPage('${s.id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="deleteSales('${s.id}')">🗑️ Delete</button>
        <button class="success-btn small-btn" onclick="printSalesInvoice('${s.id}')">🖨️ Invoice</button>
      </td>
    `;
    list.appendChild(tr);
  });
}

function openSalesHistoryModal() {
  const modal = qs('#salesHistoryModal');
  if (modal) {
    modal.style.display = 'block';
    fetchSales();
  }
}

function closeSalesHistoryModal() {
  const modal = qs('#salesHistoryModal');
  if (modal) {
    modal.style.display = 'none';
  }
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
  if (modal) {
    modal.style.display = 'none';
    resetSalesForm();
  }
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
    <div class="form-group">
      <label>SKU</label>
      <input type="text" class="product-sku" placeholder="SKU" value="${product ? escapeHtml(product.sku || '') : ''}" ${product ? 'readonly' : ''}>
    </div>
    <div class="form-group">
      <label>Product Name</label>
      <input type="text" class="product-name" placeholder="Product Name" value="${product ? escapeHtml(product.name || '') : ''}" ${product ? 'readonly' : ''}>
    </div>
    <div class="form-group">
      <label>Quantity (Stock: ${availableStock})</label>
      <input type="number" class="product-quantity" placeholder="Qty" min="1" max="${availableStock}" value="${product ? '1' : '1'}">
    </div>
    <div class="form-group">
      <label>Sale Price (RM)</label>
      <input type="number" class="product-price" placeholder="Price" step="0.01" min="0" value="${product ? (product.unitPrice || '0.00') : '0.00'}">
    </div>
    <div class="form-group">
      <label>Total (RM)</label>
      <input type="text" class="product-total" placeholder="Total" readonly value="0.00">
    </div>
    <button class="danger-btn remove-item-btn" type="button" title="Remove Item">🗑️</button>
  `;
  
  container.appendChild(itemRow);
  
  // Add event listeners
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
  
  itemRow.querySelector('.remove-item-btn').addEventListener('click', () => {
    itemRow.remove();
    updateSalesTotalAmount();
  });
  
  calculateTotal();
}

function updateSalesTotalAmount() {
  let total = 0;
  const itemRows = qsa('#salesItems .sales-item-row');
  
  itemRows.forEach(row => {
    const totalInput = row.querySelector('.product-total');
    const itemTotal = Number(totalInput.value) || 0;
    total += itemTotal;
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
      
      if (filtered.length === 0) {
        resultsContainer.innerHTML = '<div class="product-result-item">No products found</div>';
        return;
      }
      
      filtered.forEach(item => {
        const div = document.createElement('div');
        div.className = 'product-result-item';
        div.innerHTML = `
          <div class="sku">${escapeHtml(item.sku || 'N/A')}</div>
          <div class="name">${escapeHtml(item.name || 'N/A')}</div>
          <div class="stock">Stock: ${item.quantity || 0} | Price: RM ${(item.unitPrice || 0).toFixed(2)}</div>
        `;
        div.addEventListener('click', () => {
          addSalesProductItem(item);
          searchInput.value = '';
          resultsContainer.innerHTML = '';
        });
        resultsContainer.appendChild(div);
      });
    });
  }
}

async function saveSalesOrder() {
  const customer = qs('#customerName').value.trim();
  const salesDate = qs('#salesDate').value;
  const notes = qs('#salesNotes').value.trim();
  
  if (!customer) {
    alert('⚠️ Please enter customer name.');
    return;
  }
  
  const items = [];
  const itemRows = qsa('.sales-item-row');
  
  if (itemRows.length === 0) {
    alert('⚠️ Please add at least one product item.');
    return;
  }
  
  for (const row of itemRows) {
    const sku = row.querySelector('.product-sku').value.trim();
    const productName = row.querySelector('.product-name').value.trim();
    const quantity = Number(row.querySelector('.product-quantity').value);
    const salePrice = Number(row.querySelector('.product-price').value);
    
    if (!sku || !productName || !quantity || !salePrice) {
      alert('⚠️ Please fill in all fields for each product item.');
      return;
    }
    
    if (quantity <= 0) {
      alert('⚠️ Please enter a valid quantity greater than 0.');
      return;
    }
    
    if (salePrice <= 0) {
      alert('⚠️ Please enter a valid sale price greater than 0.');
      return;
    }
    
    // Check stock availability
    const inventoryItem = inventory.find(item => item.sku === sku);
    if (inventoryItem && inventoryItem.quantity < quantity) {
      alert(`❌ Insufficient stock for ${productName}. Available: ${inventoryItem.quantity}, Requested: ${quantity}`);
      return;
    }
    
    items.push({
      sku,
      productName,
      quantity,
      salePrice
    });
  }
  
  const salesData = {
    customer,
    salesDate: salesDate || new Date().toISOString().split('T')[0],
    notes,
    items
  };
  
  // Create confirmation message
  let confirmMessage = `Confirm Sales Order:\n\nCustomer: ${customer}\nItems: ${items.length}\n\nItems:\n`;
  items.forEach((item, index) => {
    confirmMessage += `${index + 1}. ${item.productName} (${item.sku}) - ${item.quantity} x RM ${item.salePrice.toFixed(2)} = RM ${(item.quantity * item.salePrice).toFixed(2)}\n`;
  });
  confirmMessage += `\nTotal Amount: RM ${salesData.items.reduce((sum, item) => sum + (item.quantity * item.salePrice), 0).toFixed(2)}`;
  
  if (!confirm(confirmMessage)) {
    return;
  }
  
  try {
    const res = await apiFetch(`${API_BASE}/sales`, {
      method: 'POST',
      body: JSON.stringify(salesData)
    });
    
    if (res.ok) {
      const savedSales = await res.json();
      alert('✅ Sales order saved successfully!');
      
      // Show print button after successful save
      qs('#printSalesBtn').classList.add('print-visible');
      
      closeNewSalesModal();
      await fetchInventory();
      await fetchSales();
      
    } else {
      const error = await res.json();
      alert(`❌ Failed to save sales order: ${error.message}`);
    }
  } catch (e) {
    console.error('Save sales order error:', e);
    alert('❌ Server connection error while saving sales order.');
  }
}

// Sales Details Functions
async function viewSalesDetails(salesId) {
  try {
    const res = await apiFetch(`${API_BASE}/sales/${salesId}`);
    if (!res.ok) throw new Error('Failed to fetch sales details');
    
    const sale = await res.json();
    
    // Populate details
    qs('#detailSalesId').textContent = sale.salesId || 'N/A';
    qs('#detailCustomer').textContent = sale.customer || 'N/A';
    qs('#detailSalesDate').textContent = new Date(sale.salesDate).toLocaleDateString();
    qs('#detailSalesTotalAmount').textContent = `RM ${(sale.totalAmount || 0).toFixed(2)}`;
    
    // Handle notes
    if (sale.notes && sale.notes.trim()) {
      qs('#detailSalesNotes').textContent = sale.notes;
      qs('#detailSalesNotesRow').style.display = 'flex';
    } else {
      qs('#detailSalesNotesRow').style.display = 'none';
    }
    
    // Populate items table
    const itemsList = qs('#salesDetailsList');
    itemsList.innerHTML = '';
    
    sale.items.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(item.sku || 'N/A')}</td>
        <td>${escapeHtml(item.productName || 'N/A')}</td>
        <td>${item.quantity || 0}</td>
        <td class="money">RM ${(item.salePrice || 0).toFixed(2)}</td>
        <td class="money">RM ${(item.totalAmount || 0).toFixed(2)}</td>
      `;
      itemsList.appendChild(tr);
    });
    
    // Set up print button
    qs('#printSalesInvoiceBtn').onclick = () => printSalesInvoice(salesId);
    
    // Show modal
    qs('#salesDetailsModal').style.display = 'block';
    
  } catch (e) {
    console.error('View sales details error:', e);
    alert('❌ Failed to load sales details.');
  }
}

function closeSalesDetailsModal() {
  qs('#salesDetailsModal').style.display = 'none';
}

function editSalesPage(salesId) {
  window.location.href = `sales-edit.html?id=${encodeURIComponent(salesId)}`;
}

async function deleteSales(id) {
  const sale = sales.find(s => String(s.id) === String(id));
  if (!sale) return;
  
  if (!confirm(`Confirm Delete Sales Order:\n${sale.salesId} for ${sale.customer}?\n\nThis will remove ${sale.items.length} items and revert inventory quantities.`)) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/sales/${id}`, { method: 'DELETE' });
    if (res.status === 204) {
      await fetchSales();
      await fetchInventory();
      alert('🗑️ Sales order deleted!');
    } else {
      alert('❌ Failed to delete sales order.');
    }
  } catch (e) {
    console.error(e);
    alert('❌ Server connection error while deleting sales order.');
  }
}

async function printSalesInvoice(salesId) {
  try {
    const res = await fetch(`${API_BASE}/sales/invoice/${salesId}`);
    if (!res.ok) throw new Error('Failed to generate invoice');
    
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    
    const sale = sales.find(s => String(s.id) === String(salesId));
    const filename = sale ? `Invoice_${sale.salesId}.pdf` : `Invoice_${salesId}.pdf`;
    
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    
  } catch (e) {
    console.error('Print sales invoice error:', e);
    alert('❌ Failed to generate sales invoice.');
  }
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
  } catch(err) {
    console.error('Fetch purchases error:', err);
  }
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
        <button class="secondary-btn small-btn" onclick="editPurchasePage('${p.id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="deletePurchase('${p.id}')">🗑️ Delete</button>
        <button class="success-btn small-btn" onclick="printPurchaseInvoice('${p.id}')">🖨️ Invoice</button>
      </td>
    `;
    list.appendChild(tr);
  });
}

function openPurchaseHistoryModal() {
  const modal = qs('#purchaseHistoryModal');
  if (modal) {
    modal.style.display = 'block';
    fetchPurchases();
  }
}

function closePurchaseHistoryModal() {
  const modal = qs('#purchaseHistoryModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function openNewPurchaseModal() {
  const modal = qs('#newPurchaseModal');
  if (modal) {
    // Reset form first
    resetPurchaseForm();
    
    // Clear any existing items
    qs('#purchaseItems').innerHTML = '';
    
    // Load product search
    loadProductSearch();
    
    // Show modal
    modal.style.display = 'block';
    
    // Reset total amount to ensure it's 0.00
    updateTotalAmount();
  }
}

function closeNewPurchaseModal() {
  const modal = qs('#newPurchaseModal');
  if (modal) {
    modal.style.display = 'none';
    // Reset form when closing to prevent state persistence
    resetPurchaseForm();
  }
}

function resetPurchaseForm() {
  qs('#supplierName').value = '';
  qs('#purchaseDate').value = new Date().toISOString().split('T')[0];
  qs('#purchaseNotes').value = '';
  qs('#productSearch').value = '';
  qs('#productResults').innerHTML = '';
  qs('#purchaseItems').innerHTML = '';
  
  // Reset total amount displays
  if (qs('#totalPurchaseAmount')) {
    qs('#totalPurchaseAmount').textContent = '0.00';
  }
  if (qs('#editTotalPurchaseAmount')) {
    qs('#editTotalPurchaseAmount').textContent = '0.00';
  }
}

function addProductItem(product = null) {
  const container = qs('#purchaseItems');
  const itemId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  
  const itemRow = document.createElement('div');
  itemRow.className = 'purchase-item-row';
  itemRow.id = itemId;
  
  itemRow.innerHTML = `
    <div class="form-group">
      <label>SKU</label>
      <input type="text" class="product-sku" placeholder="SKU" value="${product ? escapeHtml(product.sku || '') : ''}" ${product ? 'readonly' : ''}>
    </div>
    <div class="form-group">
      <label>Product Name</label>
      <input type="text" class="product-name" placeholder="Product Name" value="${product ? escapeHtml(product.name || '') : ''}" ${product ? 'readonly' : ''}>
    </div>
    <div class="form-group">
      <label>Quantity</label>
      <input type="number" class="product-quantity" placeholder="Qty" min="1" value="${product ? '1' : '1'}">
    </div>
    <div class="form-group">
      <label>Unit Price (RM)</label>
      <input type="number" class="product-price" placeholder="Price" step="0.01" min="0" value="${product ? (product.unitCost || '0.00') : '0.00'}">
    </div>
    <div class="form-group">
      <label>Total (RM)</label>
      <input type="text" class="product-total" placeholder="Total" readonly value="0.00">
    </div>
    <button class="danger-btn remove-item-btn" type="button" title="Remove Item">🗑️</button>
  `;
  
  container.appendChild(itemRow);
  
  // Add event listeners for the new row
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
  
  // Remove row button
  itemRow.querySelector('.remove-item-btn').addEventListener('click', () => {
    itemRow.remove();
    updateTotalAmount();
  });
  
  // Calculate initial total
  calculateTotal();
}

function updateTotalAmount() {
  let newTotal = 0;
  let editTotal = 0;
  
  // Calculate for new purchase modal
  const newItemRows = qsa('#purchaseItems .purchase-item-row');
  newItemRows.forEach(row => {
    const totalInput = row.querySelector('.product-total');
    const itemTotal = Number(totalInput.value) || 0;
    newTotal += itemTotal;
  });
  
  // Calculate for edit purchase modal
  const editItemRows = qsa('#editPurchaseItems .purchase-item-row');
  editItemRows.forEach(row => {
    const totalInput = row.querySelector('.product-total');
    const itemTotal = Number(totalInput.value) || 0;
    editTotal += itemTotal;
  });
  
  // Update displays
  if (qs('#totalPurchaseAmount')) {
    qs('#totalPurchaseAmount').textContent = newTotal.toFixed(2);
  }
  
  if (qs('#editTotalPurchaseAmount')) {
    qs('#editTotalPurchaseAmount').textContent = editTotal.toFixed(2);
  }
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
      
      if (filtered.length === 0) {
        resultsContainer.innerHTML = '<div class="product-result-item">No products found</div>';
        return;
      }
      
      filtered.forEach(item => {
        const div = document.createElement('div');
        div.className = 'product-result-item';
        div.innerHTML = `
          <div class="sku">${escapeHtml(item.sku || 'N/A')}</div>
          <div class="name">${escapeHtml(item.name || 'N/A')}</div>
          <div class="stock">Stock: ${item.quantity || 0} | Cost: RM ${(item.unitCost || 0).toFixed(2)}</div>
        `;
        div.addEventListener('click', () => {
          addProductItem(item);
          searchInput.value = '';
          resultsContainer.innerHTML = '';
        });
        resultsContainer.appendChild(div);
      });
    });
  }
}

async function savePurchaseOrder() {
  const supplier = qs('#supplierName').value.trim();
  const purchaseDate = qs('#purchaseDate').value;
  const notes = qs('#purchaseNotes').value.trim();
  
  if (!supplier) {
    alert('⚠️ Please enter supplier name.');
    return;
  }
  
  const items = [];
  const itemRows = qsa('.purchase-item-row');
  
  // FIXED: Check if there are any items
  if (itemRows.length === 0) {
    alert('⚠️ Please add at least one product item.');
    return;
  }
  
  for (const row of itemRows) {
    const sku = row.querySelector('.product-sku').value.trim();
    const productName = row.querySelector('.product-name').value.trim();
    const quantity = Number(row.querySelector('.product-quantity').value);
    const purchasePrice = Number(row.querySelector('.product-price').value);
    
    if (!sku || !productName || !quantity || !purchasePrice) {
      alert('⚠️ Please fill in all fields for each product item.');
      return;
    }
    
    if (quantity <= 0) {
      alert('⚠️ Please enter a valid quantity greater than 0.');
      return;
    }
    
    if (purchasePrice <= 0) {
      alert('⚠️ Please enter a valid purchase price greater than 0.');
      return;
    }
    
    items.push({
      sku,
      productName,
      quantity,
      purchasePrice
    });
  }
  
  const purchaseData = {
    supplier,
    purchaseDate: purchaseDate || new Date().toISOString().split('T')[0],
    notes,
    items
  };
  
  // Create confirmation message
  let confirmMessage = `Confirm Purchase Order:\n\nSupplier: ${supplier}\nItems: ${items.length}\n\nItems:\n`;
  items.forEach((item, index) => {
    confirmMessage += `${index + 1}. ${item.productName} (${item.sku}) - ${item.quantity} x RM ${item.purchasePrice.toFixed(2)} = RM ${(item.quantity * item.purchasePrice).toFixed(2)}\n`;
  });
  confirmMessage += `\nTotal Amount: RM ${purchaseData.items.reduce((sum, item) => sum + (item.quantity * item.purchasePrice), 0).toFixed(2)}`;
  
  if (!confirm(confirmMessage)) {
    return;
  }
  
  try {
    const res = await apiFetch(`${API_BASE}/purchases`, {
      method: 'POST',
      body: JSON.stringify(purchaseData)
    });
    
    if (res.ok) {
      const savedPurchase = await res.json();
      alert('✅ Purchase order saved successfully!');
      
      // Show print button after successful save
      qs('#printPurchaseBtn').classList.add('print-visible');
      
      closeNewPurchaseModal();
      await fetchInventory();
      await fetchPurchases();
      
    } else {
      const error = await res.json();
      alert(`❌ Failed to save purchase order: ${error.message}`);
    }
  } catch (e) {
    console.error('Save purchase order error:', e);
    alert('❌ Server connection error while saving purchase order.');
  }
}

// Purchase Details Functions
async function viewPurchaseDetails(purchaseId) {
  try {
    const res = await apiFetch(`${API_BASE}/purchases/${purchaseId}`);
    if (!res.ok) throw new Error('Failed to fetch purchase details');
    
    const purchase = await res.json();
    
    // Populate details
    qs('#detailPurchaseId').textContent = purchase.purchaseId || 'N/A';
    qs('#detailSupplier').textContent = purchase.supplier || 'N/A';
    qs('#detailPurchaseDate').textContent = new Date(purchase.purchaseDate).toLocaleDateString();
    qs('#detailTotalAmount').textContent = `RM ${(purchase.totalAmount || 0).toFixed(2)}`;
    
    // Handle notes
    if (purchase.notes && purchase.notes.trim()) {
      qs('#detailNotes').textContent = purchase.notes;
      qs('#detailNotesRow').style.display = 'flex';
    } else {
      qs('#detailNotesRow').style.display = 'none';
    }
    
    // Populate items table
    const itemsList = qs('#purchaseDetailsList');
    itemsList.innerHTML = '';
    
    purchase.items.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(item.sku || 'N/A')}</td>
        <td>${escapeHtml(item.productName || 'N/A')}</td>
        <td>${item.quantity || 0}</td>
        <td class="money">RM ${(item.purchasePrice || 0).toFixed(2)}</td>
        <td class="money">RM ${(item.totalAmount || 0).toFixed(2)}</td>
      `;
      itemsList.appendChild(tr);
    });
    
    // Set up print button
    qs('#printDetailsInvoiceBtn').onclick = () => printPurchaseInvoice(purchaseId);
    
    // Show modal
    qs('#purchaseDetailsModal').style.display = 'block';
    
  } catch (e) {
    console.error('View purchase details error:', e);
    alert('❌ Failed to load purchase details.');
  }
}

function closePurchaseDetailsModal() {
  qs('#purchaseDetailsModal').style.display = 'none';
}

function editPurchasePage(purchaseId) {
  window.location.href = `purchase-edit.html?id=${encodeURIComponent(purchaseId)}`;
}

async function deletePurchase(id) {
  const purchase = purchases.find(p => String(p.id) === String(id));
  if (!purchase) return;
  
  if (!confirm(`Confirm Delete Purchase Order:\n${purchase.purchaseId} from ${purchase.supplier}?\n\nThis will remove ${purchase.items.length} items and revert inventory quantities.`)) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/purchases/${id}`, { method: 'DELETE' });
    if (res.status === 204) {
      await fetchPurchases();
      await fetchInventory();
      alert('🗑️ Purchase order deleted!');
    } else {
      alert('❌ Failed to delete purchase order.');
    }
  } catch (e) {
    console.error(e);
    alert('❌ Server connection error while deleting purchase order.');
  }
}

async function printPurchaseInvoice(purchaseId) {
  try {
    const res = await fetch(`${API_BASE}/purchases/invoice/${purchaseId}`);
    if (!res.ok) throw new Error('Failed to generate invoice');
    
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    
    const purchase = purchases.find(p => String(p.id) === String(purchaseId));
    const filename = purchase ? `Invoice_${purchase.purchaseId}.pdf` : `Invoice_${purchaseId}.pdf`;
    
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    
  } catch (e) {
    console.error('Print invoice error:', e);
    alert('❌ Failed to generate invoice.');
  }
}

// =========================================
// NEW: Enhanced Report Generation with Date Range
// =========================================
function openReportModal() {
  const modal = qs('#reportModal');
  if (modal) {
    modal.style.display = 'block';
    // Set default dates (current month)
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    qs('#reportStartDate').value = firstDay.toISOString().split('T')[0];
    qs('#reportEndDate').value = today.toISOString().split('T')[0];
    
    // Reset selection
    qsa('.report-option').forEach(opt => opt.classList.remove('selected'));
  }
}

function closeReportModal() {
  const modal = qs('#reportModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function selectReportType(type) {
  qsa('.report-option').forEach(opt => opt.classList.remove('selected'));
  qs(`#report-${type}`).classList.add('selected');
  qs('#selectedReportType').value = type;
}

async function generateSelectedReport() {
  const reportType = qs('#selectedReportType').value;
  const startDate = qs('#reportStartDate').value;
  const endDate = qs('#reportEndDate').value;
  
  if (!reportType) {
    alert('⚠️ Please select a report type.');
    return;
  }
  
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    alert('❌ Start date cannot be after end date.');
    return;
  }
  
  closeReportModal();
  
  switch (reportType) {
    case 'inventory':
      await generateInventoryReport(startDate, endDate);
      break;
    case 'purchase':
      await generatePurchaseReport(startDate, endDate);
      break;
    case 'sales':
      await generateSalesReport(startDate, endDate);
      break;
    case 'all':
      await generateAllReports(startDate, endDate);
      break;
  }
}

async function generateInventoryReport(startDate, endDate) {
  if (!confirm('Generate Inventory Report?')) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/inventory/report/pdf`, {
      method: 'POST',
      body: JSON.stringify({ startDate, endDate })
    });
    
    if (!res.ok) throw new Error('Failed to generate report');
    
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `Inventory_Report_${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    
    alert('✅ Inventory Report Generated Successfully!');
    
  } catch (e) {
    console.error('Inventory report error:', e);
    alert('❌ Failed to generate inventory report.');
  }
}

async function generatePurchaseReport(startDate, endDate) {
  if (!confirm('Generate Purchase Report?')) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/purchases/report/pdf`, {
      method: 'POST',
      body: JSON.stringify({ startDate, endDate })
    });
    
    if (!res.ok) throw new Error('Failed to generate report');
    
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `Purchase_Report_${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    
    alert('✅ Purchase Report Generated Successfully!');
    
  } catch (e) {
    console.error('Purchase report error:', e);
    alert('❌ Failed to generate purchase report.');
  }
}

async function generateSalesReport(startDate, endDate) {
  if (!confirm('Generate Sales Report?')) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/sales/report/pdf`, {
      method: 'POST',
      body: JSON.stringify({ startDate, endDate })
    });
    
    if (!res.ok) throw new Error('Failed to generate report');
    
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `Sales_Report_${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    
    alert('✅ Sales Report Generated Successfully!');
    
  } catch (e) {
    console.error('Sales report error:', e);
    alert('❌ Failed to generate sales report.');
  }
}

async function generateAllReports(startDate, endDate) {
  if (!confirm('Generate All Reports (Inventory, Purchase, Sales)?')) return;
  
  try {
    // Generate inventory report
    await generateInventoryReport(startDate, endDate);
    
    // Generate purchase report
    await generatePurchaseReport(startDate, endDate);
    
    // Generate sales report
    await generateSalesReport(startDate, endDate);
    
    alert('✅ All Reports Generated Successfully!');
    
  } catch (e) {
    console.error('All reports error:', e);
    alert('❌ Failed to generate some reports.');
  }
}

// =========================================
// NEW: Folder Management for Documents
// =========================================
async function fetchFolders() {
  try {
    const res = await apiFetch(`${API_BASE}/folders`);
    if (res.ok) {
      folders = await res.json();
      renderFolders();
    }
  } catch (err) {
    console.error('Fetch folders error:', err);
  }
}

function renderFolders() {
  const folderList = qs('#folderList');
  if (!folderList) return;
  
  folderList.innerHTML = '';
  
  const currentFolders = folders.filter(folder => 
    (currentFolder === 'root' && !folder.parentFolder) ||
    (currentFolder !== 'root' && folder.parentFolder === currentFolder)
  );
  
  currentFolders.forEach(folder => {
    const folderItem = document.createElement('div');
    folderItem.className = 'folder-item';
    folderItem.innerHTML = `
      <div class="folder-icon">📁</div>
      <div class="folder-name">${escapeHtml(folder.name)}</div>
      <div class="folder-info">Created by: ${escapeHtml(folder.createdBy || 'System')}</div>
      <div class="folder-actions">
        <button class="secondary-btn small-btn" onclick="renameFolder('${folder.id}')">✏️</button>
        <button class="danger-btn small-btn" onclick="deleteFolder('${folder.id}')">🗑️</button>
      </div>
    `;
    folderItem.addEventListener('click', (e) => {
      if (!e.target.closest('.folder-actions')) {
        navigateToFolder(folder.id);
      }
    });
    folderList.appendChild(folderItem);
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
  
  // Root breadcrumb
  const rootItem = document.createElement('div');
  rootItem.className = `breadcrumb-item ${currentFolder === 'root' ? 'active' : ''}`;
  rootItem.textContent = 'Root';
  rootItem.addEventListener('click', () => navigateToFolder('root'));
  breadcrumb.appendChild(rootItem);
  
  // Build path if not in root
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
  const folderName = prompt('Enter folder name:');
  if (!folderName) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/folders`, {
      method: 'POST',
      body: JSON.stringify({ 
        name: folderName,
        parentFolder: currentFolder === 'root' ? null : currentFolder
      })
    });
    
    if (res.ok) {
      await fetchFolders();
      alert('✅ Folder created successfully!');
    } else {
      const error = await res.json();
      alert(`❌ Failed to create folder: ${error.message}`);
    }
  } catch (err) {
    console.error('Create folder error:', err);
    alert('❌ Server error while creating folder.');
  }
}

async function renameFolder(folderId) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;
  
  const newName = prompt('Enter new folder name:', folder.name);
  if (!newName) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/folders/${folderId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: newName })
    });
    
    if (res.ok) {
      await fetchFolders();
      alert('✅ Folder renamed successfully!');
    } else {
      const error = await res.json();
      alert(`❌ Failed to rename folder: ${error.message}`);
    }
  } catch (err) {
    console.error('Rename folder error:', err);
    alert('❌ Server error while renaming folder.');
  }
}

async function deleteFolder(folderId) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;
  
  if (!confirm(`Are you sure you want to delete folder "${folder.name}"?`)) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/folders/${folderId}`, {
      method: 'DELETE'
    });
    
    if (res.status === 204) {
      await fetchFolders();
      if (currentFolder === folderId) {
        navigateToFolder('root');
      }
      alert('✅ Folder deleted successfully!');
    } else {
      const error = await res.json();
      alert(`❌ Failed to delete folder: ${error.message}`);
    }
  } catch (err) {
    console.error('Delete folder error:', err);
    alert('❌ Server error while deleting folder.');
  }
}

// =========================================
// UPDATED: Document Management with Folders
// =========================================
async function fetchDocuments() {
  try {
    const url = currentFolder === 'root' 
      ? `${API_BASE}/documents` 
      : `${API_BASE}/documents?folder=${currentFolder}`;
    
    const res = await apiFetch(url);
    if (!res.ok) throw new Error('Failed to fetch documents');
    const data = await res.json();
    documents = data.map(d => ({ ...d, id: d.id || d._id }));
    renderDocuments(documents);
  } catch(err) {
    console.error(err);
  }
}

function renderDocuments(docs) {
  const list = qs('#docList');
  if(!list) return;
  list.innerHTML = '';

  docs.forEach(d => {
    const id = d.id || d._id;
    const sizeMB = ((d.sizeBytes || d.size || 0) / (1024*1024)).toFixed(2);
    
    // Check if document is likely valid
    const isLikelyValid = d.size > 0 && parseFloat(sizeMB) > 0;
    const fileType = d.contentType || 'Unknown';
    
    let displayType = fileType.split('/').pop();
    if (displayType === 'vnd.openxmlformats-officedocument.spreadsheetml.sheet') displayType = 'xlsx';
    if (displayType === 'vnd.openxmlformats-officedocument.wordprocessingml.document') displayType = 'docx';
    if (displayType === 'vnd.openxmlformats-officedocument.presentationml.presentation') displayType = 'pptx';
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(d.name||'')}</td>
      <td>${sizeMB} MB</td>
      <td>${new Date(d.date).toLocaleString()}</td>
      <td>${displayType}</td>
      <td class="actions">
        <button class="primary-btn small-btn download-btn" data-id="${id}" data-name="${escapeHtml(d.name||'')}">
          ⬇️ Download
        </button>
        <button class="danger-btn small-btn delete-btn" data-id="${id}">🗑️ Delete</button>
        <button class="secondary-btn small-btn verify-btn" data-id="${id}" title="Verify File">🔍 Verify</button>
        <button class="info-btn small-btn preview-btn" data-id="${id}" data-name="${escapeHtml(d.name||'')}" title="Preview">👁️ Preview</button>
      </td>
    `;
    list.appendChild(tr);
  });

  bindDocumentEvents();
}

// Update upload function to support folders
async function uploadDocuments(){
  const fileInput = qs('#docUpload');
  const files = fileInput?.files;
  let msgEl = qs('#uploadMessage');
  
  if(!msgEl){ 
    msgEl = document.createElement('p'); 
    msgEl.id = 'uploadMessage'; 
    if(qs('.controls')) qs('.controls').appendChild(msgEl); 
  }

  if(!files || files.length === 0) { 
    showMsg(msgEl, '⚠️ Please select a file to upload.', 'red'); 
    return; 
  }
  
  if (files.length > 1) {
    showMsg(msgEl, '⚠️ Only single file uploads are supported. Please select only one file.', 'red');
    fileInput.value = '';
    return;
  }
  
  const file = files[0];
  
  // Validate file size
  if (file.size === 0) {
    showMsg(msgEl, '⚠️ The selected file is empty (0 bytes).', 'red');
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    showMsg(msgEl, '⚠️ File size exceeds 50MB limit.', 'red');
    return;
  }

  if(!confirm(`Confirm Upload: Upload file "${file.name}" (${(file.size / (1024*1024)).toFixed(2)} MB)?`)) { 
    showMsg(msgEl, 'Upload cancelled.', 'orange'); 
    return; 
  }
  
  showMsg(msgEl, `📤 Uploading file "${file.name}"...`, 'orange');

  try {
    const fileBuffer = await file.arrayBuffer();
    
    if (!fileBuffer || fileBuffer.byteLength === 0) {
      throw new Error("File reading failed - empty buffer");
    }

    const uint8Array = new Uint8Array(fileBuffer);
    
    const res = await fetch(`${API_BASE}/documents`, { 
        method: 'POST', 
        body: uint8Array,
        headers: {
            'Content-Type': file.type || 'application/octet-stream', 
            'X-Username': getUsername(),
            'X-File-Name': encodeURIComponent(file.name),
            'X-Folder-Id': currentFolder === 'root' ? '' : currentFolder,
            'Content-Length': fileBuffer.byteLength.toString()
        }
    });

    if(res.ok) {
      const result = await res.json();
      showMsg(msgEl, `✅ Successfully uploaded: "${file.name}" (${(file.size / (1024*1024)).toFixed(2)} MB)`, 'green');
      await fetchDocuments();
      
    } else {
      const errorData = await res.json().catch(() => ({ message: 'Unknown server error' }));
      throw new Error(errorData.message || `Server error: ${res.status}`);
    }
  } catch(e) {
    console.error('❌ Upload error:', e);
    showMsg(msgEl, `❌ Upload failed: ${e.message}`, 'red');
    if(fileInput) fileInput.value = '';
    return;
  }
  
  if(fileInput) fileInput.value = '';
  setTimeout(() => { 
    if(msgEl) {
      msgEl.remove(); 
    }
  }, 3000);
}

// NEW: Document preview function
function previewDocument(docId, docName) {
  const previewUrl = `${API_BASE}/documents/preview/${docId}`;
  const modal = qs('#previewModal');
  const iframe = qs('#previewIframe');
  const previewTitle = qs('#previewTitle');
  
  if (modal && iframe && previewTitle) {
    previewTitle.textContent = `Preview: ${docName}`;
    iframe.src = previewUrl;
    modal.style.display = 'block';
  }
}

function closePreviewModal() {
  const modal = qs('#previewModal');
  const iframe = qs('#previewIframe');
  
  if (modal && iframe) {
    modal.style.display = 'none';
    iframe.src = '';
  }
}

function searchDocuments() {
  const q = (qs('#searchDocs')?.value || '').toLowerCase().trim();
  const filtered = documents.filter(d => (d.name||'').toLowerCase().includes(q) || (d.date? new Date(d.date).toLocaleString().toLowerCase() : '').includes(q));
  renderDocuments(filtered);
}

// Add this function to bind events properly
function bindDocumentEvents() {
  // Download buttons
  qsa('.download-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.getAttribute('data-id');
      const name = this.getAttribute('data-name');
      downloadDocument(id, name);
    });
  });

  // Delete buttons
  qsa('.delete-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.getAttribute('data-id');
      deleteDocumentConfirm(id);
    });
  });

  // Verify buttons
  qsa('.verify-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.getAttribute('data-id');
      verifyDocument(id);
    });
  });

  // Preview buttons
  qsa('.preview-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.getAttribute('data-id');
      const name = this.getAttribute('data-name');
      previewDocument(id, name);
    });
  });
}

// Improved download function with verification
async function downloadDocument(docId, fileName) {
  if(!confirm(`Confirm Download: ${fileName}?`)) return;
  
  try {
    console.log(`Starting download: ${fileName} (ID: ${docId})`);
    
    // First verify the document
    const verifyRes = await fetch(`${API_BASE}/documents/${docId}/verify`);
    if (!verifyRes.ok) {
      throw new Error('Failed to verify document');
    }
    
    const verifyData = await verifyRes.json();
    console.log('Document verification:', verifyData);
    
    if (!verifyData.valid) {
      throw new Error(`Document is corrupted or empty. Stored size: ${verifyData.storedSize} bytes, Actual data: ${verifyData.actualDataLength} bytes`);
    }

    // Now download the document
    const res = await fetch(`${API_BASE}/documents/download/${docId}`);
    
    if(!res.ok) {
      let errorMessage = 'Download failed';
      try {
        const errorData = await res.json();
        errorMessage = errorData.message || errorMessage;
      } catch (e) {
        errorMessage = `Server error: ${res.status} ${res.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const contentLength = res.headers.get('Content-Length');
    const contentType = res.headers.get('Content-Type');
    
    console.log(`Download response:`, {
      status: res.status,
      contentLength,
      contentType
    });

    if (!contentLength || contentLength === '0') {
      throw new Error('File is empty or not properly stored');
    }

    const blob = await res.blob();
    
    console.log(`Blob created:`, {
      size: blob.size,
      type: blob.type
    });

    if (blob.size === 0) {
      throw new Error('Downloaded file is empty');
    }

    // Create and trigger download
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    
    // Clean up
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 100);

    console.log(`Download completed: ${fileName}`);

  } catch (error) {
    console.error('Download error:', error);
    alert(`❌ Download Failed: ${error.message}`);
    
    // Offer to regenerate if it's a report
    if (fileName.includes('Inventory_Report') && confirm('This report file appears to be corrupted. Would you like to generate a new one?')) {
      if (fileName.endsWith('.pdf')) {
        generateInventoryReport();
      }
    }
  }
}

async function verifyDocument(docId) {
  try {
    const res = await fetch(`${API_BASE}/documents/${docId}/verify`);
    if (res.ok) {
      const data = await res.json();
      
      let message = `Document Verification:\n\n`;
      message += `Name: ${data.name}\n`;
      message += `Stored Size: ${data.storedSize} bytes\n`;
      message += `Actual Data: ${data.actualDataLength} bytes\n`;
      message += `Has Data: ${data.hasData ? 'YES' : 'NO'}\n`;
      message += `Is Buffer: ${data.isBuffer ? 'YES' : 'NO'}\n`;
      message += `Valid: ${data.valid ? 'YES ✅' : 'NO ❌'}\n`;
      message += `Content Type: ${data.contentType}\n`;
      message += `Upload Date: ${new Date(data.date).toLocaleString()}`;
      
      alert(message);
    } else {
      alert('Verification failed');
    }
  } catch (e) {
    console.error('Verify error:', e);
    alert('Verification failed: ' + e.message);
  }
}

async function deleteDocumentConfirm(id) {
  const doc = documents.find(d => String(d.id) === String(id));
  if(!doc) {
    alert('Document not found in local list');
    return;
  }
  
  if(!confirm(`Delete document: ${doc.name}?`)) return;
  
  try {
    console.log(`Deleting document: ${id}`);
    const res = await apiFetch(`${API_BASE}/documents/${id}`, { method: 'DELETE' });
    
    if(res.status === 204 || res.ok) { 
      await fetchDocuments(); 
      alert('🗑️ Document deleted successfully!'); 
    } else {
      const errorData = await res.json().catch(() => ({ message: 'Unknown error' }));
      alert('❌ Failed to delete document: ' + errorData.message);
    }
  } catch(e) { 
    console.error('Delete error:', e); 
    alert('❌ Server error while deleting document: ' + e.message); 
  }
}

// Cleanup corrupted documents function
async function cleanupCorruptedDocuments() {
  if (!confirm('This will remove all documents that are corrupted or have 0 bytes. Continue?')) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/cleanup-documents`, { method: 'DELETE' });
    const data = await res.json();
    
    if (data.success) {
      alert(`✅ Cleanup completed! Removed ${data.deletedCount} corrupted documents.`);
      await fetchDocuments();
    } else {
      alert('❌ Cleanup failed: ' + data.message);
    }
  } catch (e) {
    console.error('Cleanup error:', e);
    alert('Cleanup failed: ' + e.message);
  }
}

// =========================================
// NEW: Statements Management
// =========================================
function openStatementsModal() {
  const modal = qs('#statementsModal');
  if (modal) {
    modal.style.display = 'block';
    switchTab('inventory-reports');
  }
}

function closeStatementsModal() {
  const modal = qs('#statementsModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function switchTab(tabName) {
  // Update tab buttons
  qsa('.tab-button').forEach(btn => btn.classList.remove('active'));
  qs(`#tab-${tabName}`).classList.add('active');
  
  // Update tab content
  qsa('.tab-content').forEach(content => content.classList.remove('active'));
  qs(`#content-${tabName}`).classList.add('active');
  
  // Load statements for the selected tab
  loadStatements(tabName);
}

async function loadStatements(type) {
  try {
    const res = await apiFetch(`${API_BASE}/statements/${type}`);
    if (res.ok) {
      const statements = await res.json();
      renderStatements(type, statements);
    }
  } catch (err) {
    console.error('Load statements error:', err);
  }
}

function renderStatements(type, statements) {
  const container = qs(`#${type}List`);
  if (!container) return;
  
  container.innerHTML = '';
  
  if (statements.length === 0) {
    container.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No statements found</td></tr>';
    return;
  }
  
  let totalSize = 0;
  
  statements.forEach(doc => {
    totalSize += doc.size || 0;
    
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
  
  // Update summary information
  const countElement = qs(`#${type.replace('-', '')}Count`);
  const sizeElement = qs(`#${type.replace('-', '')}Size`);
  
  if (countElement) countElement.textContent = statements.length;
  if (sizeElement) sizeElement.textContent = (totalSize / (1024*1024)).toFixed(2);
}

// =========================================
// ACTIVITY LOGS AND DASHBOARD FUNCTIONS
// =========================================
async function fetchLogs() {
  try {
    const res = await apiFetch(`${API_BASE}/logs`);
    if(!res.ok) throw new Error('Failed to fetch logs');
    activityLog = await res.json();
    renderLogs();
  } catch(err) { console.error(err); }
}

function renderLogs() {
  const list = qs('#logList');
  if (!list) return;

  list.innerHTML = "";

  activityLog.forEach(log => {
    const tr = document.createElement("tr");

    const userCell = document.createElement("td");
    userCell.textContent = log.user || "System";

    const actionCell = document.createElement("td");
    actionCell.textContent = log.action || "";

    const timeCell = document.createElement("td");
    const timeStr = log.time ? new Date(log.time).toLocaleString() : "N/A";
    timeCell.textContent = timeStr;

    tr.appendChild(userCell);
    tr.appendChild(actionCell);
    tr.appendChild(timeCell);

    list.appendChild(tr);
  });

  renderDashboardData();
}

function renderDashboardData(){
  const tbody = qs('#recentActivities');
  if(tbody) {
    tbody.innerHTML = '';
    activityLog.slice().slice(0,5).forEach(l => {
      const timeStr = l.time ? new Date(l.time).toLocaleString() : new Date().toLocaleString();
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(l.user||'Admin')}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(timeStr)}</td>`;
      tbody.appendChild(tr);
    });
  }

  if(qs('#dash_totalItems')) {
    let totalValue = 0, totalRevenue = 0, totalProfit = 0, totalStock = 0;
    inventory.forEach(it => {
      const qty = Number(it.quantity || 0);
      const invVal = qty * Number(it.unitCost || 0);
      const rev = qty * Number(it.unitPrice || 0);
      const profit = rev - invVal;
      
      totalValue += invVal;
      totalRevenue += rev;
      totalProfit += profit;
      totalStock += qty;
    });
    qs('#dash_totalItems').textContent = inventory.length;
    
    // Update dashboard cards if they exist
    if(qs('#dash_totalValue')) qs('#dash_totalValue').textContent = totalValue.toFixed(2);
    if(qs('#dash_totalRevenue')) qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
    if(qs('#dash_totalProfit')) qs('#dash_totalProfit').textContent = totalProfit.toFixed(2);
    if(qs('#dash_totalStock')) qs('#dash_totalStock').textContent = totalStock;
  }
}

// =========================================
// AUTHENTICATION FUNCTIONS
// =========================================
async function login(){
  const user = qs('#username')?.value?.trim();
  const pass = qs('#password')?.value?.trim();
  const msg = qs('#loginMessage');
  showMsg(msg, '');
  if(!user || !pass) { showMsg(msg, '⚠️ Please enter username and password.', 'red'); return; }

  try {
    const res = await apiFetch(`${API_BASE}/login`, { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
    const data = await res.json();
    if(res.ok) {
      sessionStorage.setItem('isLoggedIn', 'true');
      sessionStorage.setItem('adminName', user);
      showMsg(msg, '✅ Login successful! Redirecting...', 'green');
      setTimeout(()=> window.location.href = 'inventory.html', 700);
    } else {
      showMsg(msg, `❌ ${data.message || 'Login failed.'}`, 'red');
    }
  } catch(e) {
    showMsg(msg, '❌ Server connection failed.', 'red');
    console.error(e);
  }
}

async function register(){
  const user = qs('#newUsername')?.value?.trim();
  const pass = qs('#newPassword')?.value?.trim();
  const code = qs('#securityCode')?.value?.trim();
  const msg = qs('#registerMessage');
  showMsg(msg, '');
  if(!user || !pass || !code) { showMsg(msg, '⚠️ Please fill in all fields.', 'red'); return; }

  try {
    const res = await apiFetch(`${API_BASE}/register`, { method: 'POST', body: JSON.stringify({ username: user, password: pass, securityCode: code }) });
    const data = await res.json();
    if(res.ok) {
      showMsg(msg, '✅ Registered successfully! You can now log in.', 'green');
      setTimeout(()=> toggleForm(), 900);
    } else {
      showMsg(msg, `❌ ${data.message || 'Registration failed.'}`, 'red');
    }
  } catch(e) { showMsg(msg, '❌ Server connection failed.', 'red'); console.error(e); }
}

function toggleForm(){
  const loginForm = qs('#loginForm');
  const registerForm = qs('#registerForm');
  const formTitle = qs('#formTitle');
  if(!loginForm || !registerForm || !formTitle) return;
  if(getComputedStyle(loginForm).display === 'none') {
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    formTitle.textContent = '🔐 Admin Login';
  } else {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
    formTitle.textContent = '🧾 Register Account';
  }
}

// =========================================
// SETTINGS PAGE FUNCTIONS
// =========================================
function bindSettingPage(){
  const currentUsername = getUsername();
  if(qs('#currentUser')) qs('#currentUser').textContent = currentUsername;

  qs('#changePasswordBtn')?.addEventListener('click', async ()=> {
    const newPass = qs('#newPassword')?.value;
    const confPass = qs('#confirmPassword')?.value;
    const code = qs('#securityCode')?.value;
    const msgEl = qs('#passwordMessage');
    showMsg(msgEl, '');
    if(!newPass || !confPass || !code) { return showMsg(msgEl, '⚠️ Please fill in all fields.', 'red'); }
    if(newPass !== confPass) { return showMsg(msgEl, '⚠️ New password and confirmation do not match.', 'red'); }
    if(!confirm('Confirm Password Change? You will be logged out after a successful update.')) return;

    try {
      const res = await apiFetch(`${API_BASE}/account/password`, { method: 'PUT', body: JSON.stringify({ username: currentUsername, newPassword: newPass, securityCode: code }) });
      const data = await res.json();
      if(res.ok) {
        showMsg(msgEl, '✅ Password updated successfully! Please log in again.', 'green');
        qs('#newPassword').value = '';
        qs('#confirmPassword').value = '';
        qs('#securityCode').value = '';
        setTimeout(logout, 1500);
      } else {
        showMsg(msgEl, `❌ ${data.message || 'Failed to change password.'}`, 'red');
      }
    } catch(e) { showMsg(msgEl, '❌ Server connection failed during password change.', 'red'); }
  });

  qs('#deleteAccountBtn')?.addEventListener('click', async ()=> {
    if(!confirm(`⚠️ WARNING: Are you absolutely sure you want to delete the account for "${currentUsername}"?`)) return;
    const code = prompt('Enter Admin Security Code to CONFIRM account deletion:');
    if(!code) return alert('Deletion cancelled.');
    try {
      const res = await apiFetch(`${API_BASE}/account`, { method: 'DELETE', body: JSON.stringify({ username: currentUsername, securityCode: code }) });
      const data = await res.json();
      if(res.ok) { alert('🗑️ Account deleted successfully. You will now be logged out.'); logout(); }
      else alert(`❌ ${data.message || 'Failed to delete account.'}`);
    } catch(e) { alert('❌ Server connection failed during account deletion.'); }
  });
}

// =========================================
// EDIT PAGE BINDING FUNCTIONS
// =========================================
function bindPurchaseEditPage() {
  // Implementation for purchase edit page binding
  console.log('Purchase edit page binding');
}

function bindSalesEditPage() {
  // Implementation for sales edit page binding
  console.log('Sales edit page binding');
}

// =========================================
// ENHANCED UI BINDING
// =========================================
function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', openReportModal);
  qs('#statementsBtn')?.addEventListener('click', openStatementsModal);
  qs('#searchInput')?.addEventListener('input', searchInventory);
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { 
    if(qs('#searchInput')) { 
      qs('#searchInput').value=''; 
      searchInventory(); 
    } 
  });
  
  // Purchase functionality
  qs('#purchaseHistoryBtn')?.addEventListener('click', openPurchaseHistoryModal);
  qs('#newPurchaseBtn')?.addEventListener('click', openNewPurchaseModal);
  qs('#addProductItem')?.addEventListener('click', () => addProductItem());
  qs('#savePurchaseBtn')?.addEventListener('click', savePurchaseOrder);
  qs('#printPurchaseBtn')?.addEventListener('click', () => {
    // This would print the last saved purchase
    if (purchases.length > 0) {
      printPurchaseInvoice(purchases[purchases.length - 1].id);
    } else {
      alert('No recent purchase to print.');
    }
  });
  qs('#closePurchaseModal')?.addEventListener('click', closeNewPurchaseModal);
  
  // Sales functionality
  qs('#salesHistoryBtn')?.addEventListener('click', openSalesHistoryModal);
  qs('#newSalesBtn')?.addEventListener('click', openNewSalesModal);
  qs('#addSalesProductItem')?.addEventListener('click', () => addSalesProductItem());
  qs('#saveSalesBtn')?.addEventListener('click', saveSalesOrder);
  qs('#printSalesBtn')?.addEventListener('click', () => {
    // This would print the last saved sales
    if (sales.length > 0) {
      printSalesInvoice(sales[sales.length - 1].id);
    } else {
      alert('No recent sales to print.');
    }
  });
  qs('#closeSalesModal')?.addEventListener('click', closeNewSalesModal);
  
  // Report generation
  qs('#generateReportBtn')?.addEventListener('click', generateSelectedReport);
  qs('#closeReportModal')?.addEventListener('click', closeReportModal);
  
  // Statements
  qs('#closeStatementsModal')?.addEventListener('click', closeStatementsModal);
  
  // Modal close handlers
  qsa('.close').forEach(closeBtn => {
    closeBtn.addEventListener('click', function() {
      const modal = this.closest('.modal');
      if (modal) {
        modal.style.display = 'none';
      }
    });
  });
  
  window.addEventListener('click', (e) => {
    if (e.target === qs('#purchaseHistoryModal')) closePurchaseHistoryModal();
    if (e.target === qs('#newPurchaseModal')) closeNewPurchaseModal();
    if (e.target === qs('#salesHistoryModal')) closeSalesHistoryModal();
    if (e.target === qs('#newSalesModal')) closeNewSalesModal();
    if (e.target === qs('#reportModal')) closeReportModal();
    if (e.target === qs('#statementsModal')) closeStatementsModal();
    if (e.target === qs('#previewModal')) closePreviewModal();
    if (e.target === qs('#purchaseDetailsModal')) closePurchaseDetailsModal();
    if (e.target === qs('#salesDetailsModal')) closeSalesDetailsModal();
  });
  
  // Date range filter events
  bindDateRangeFilterEvents();
}

function bindDocumentsUI(){
  qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments);
  qs('#searchDocs')?.addEventListener('input', searchDocuments);
  qs('#createFolderBtn')?.addEventListener('click', createFolder);
  qs('#navigateToRoot')?.addEventListener('click', () => navigateToFolder('root'));
}

// =========================================
// ENHANCED INITIALIZATION
// =========================================
window.addEventListener('load', async () => {
  initializeTheme();
  
  const adminName = getUsername();
  if(qs('#adminName')) qs('#adminName').textContent = adminName;

  try {
    // Fetch company info first
    await fetchCompanyInfo();
    
    if(currentPage.includes('inventory') || currentPage === '' || currentPage === 'index.html') { 
      await fetchInventory(); 
      bindInventoryUI(); 
    }
    if(currentPage.includes('documents')) { 
      await fetchFolders();
      await fetchDocuments(); 
      bindDocumentsUI(); 
    }
    if(currentPage.includes('log') || currentPage === '' || currentPage === 'index.html') { 
      await fetchLogs(); 
      await fetchInventory(); 
    }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
    if(currentPage.includes('purchase-edit')) bindPurchaseEditPage();
    if(currentPage.includes('sales-edit')) bindSalesEditPage();
  } catch(e) { console.error('Init error', e); }
});

// =========================================
// DOM BINDINGS
// =========================================
document.addEventListener('DOMContentLoaded', ()=> {
  if(currentPage.includes('login.html')) {
    qs('#loginBtn')?.addEventListener('click', login);
    qs('#registerBtn')?.addEventListener('click', register);
    qs('#toggleToRegister')?.addEventListener('click', toggleForm);
    qs('#toggleToLogin')?.addEventListener('click', toggleForm);
    if (qs('#contactPhone') && window.CONFIG && CONFIG.CONTACT_PHONE) qs('#contactPhone').textContent = CONFIG.CONTACT_PHONE;
  }
});

// Tooltip function for cards
function showCardTooltip(message) {
  // Simple alert for now, can be enhanced with a proper tooltip library
  // alert(message);
}

// =========================================
// EXPORT FUNCTIONS TO GLOBAL SCOPE
// =========================================
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;
window.verifyDocument = verifyDocument;
window.cleanupCorruptedDocuments = cleanupCorruptedDocuments;
window.showCardTooltip = showCardTooltip;

// Purchase functions
window.openPurchaseHistoryModal = openPurchaseHistoryModal;
window.closePurchaseHistoryModal = closePurchaseHistoryModal;
window.openNewPurchaseModal = openNewPurchaseModal;
window.closeNewPurchaseModal = closeNewPurchaseModal;
window.savePurchaseOrder = savePurchaseOrder;
window.printPurchaseInvoice = printPurchaseInvoice;
window.deletePurchase = deletePurchase;
window.editPurchase = editPurchase;
window.viewPurchase = viewPurchase;
window.editPurchasePage = editPurchasePage;
window.closePurchaseDetailsModal = closePurchaseDetailsModal;

// Sales functions
window.openSalesHistoryModal = openSalesHistoryModal;
window.closeSalesHistoryModal = closeSalesHistoryModal;
window.openNewSalesModal = openNewSalesModal;
window.closeNewSalesModal = closeNewSalesModal;
window.saveSalesOrder = saveSalesOrder;
window.printSalesInvoice = printSalesInvoice;
window.deleteSales = deleteSales;
window.editSales = editSales;
window.viewSales = viewSalesDetails;
window.editSalesPage = editSalesPage;
window.closeSalesDetailsModal = closeSalesDetailsModal;

// Report functions
window.openReportModal = openReportModal;
window.selectReportType = selectReportType;
window.generateSelectedReport = generateSelectedReport;

// Statements functions
window.openStatementsModal = openStatementsModal;
window.switchTab = switchTab;
window.previewDocument = previewDocument;
window.closePreviewModal = closePreviewModal;

// Folder functions
window.createFolder = createFolder;
window.renameFolder = renameFolder;
window.deleteFolder = deleteFolder;
window.navigateToFolder = navigateToFolder;

// Company info functions
window.updateCompanyInfo = updateCompanyInfo;

// Login/Register functions
window.login = login;
window.register = register;
window.toggleForm = toggleForm;
