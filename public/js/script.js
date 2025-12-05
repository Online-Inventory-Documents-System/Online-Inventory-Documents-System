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

// Pagination variables
let currentPageNumber = 1;
let itemsPerPage = 10;
let totalPages = 1;
let filteredInventory = [];

// Total profit earned
let totalProfitEarned = 0;

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

// Enhanced API fetch with error handling
async function apiFetch(url, options = {}) {
  const user = getUsername();
  options.headers = {
    'Content-Type': 'application/json',
    'X-Username': user,
    ...options.headers,
  };

  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    
    return response;
  } catch (error) {
    console.error('API fetch error:', error);
    throw error;
  }
}

// Data validation helper
function validateRequiredFields(fields) {
  const errors = [];
  
  fields.forEach(({ name, value, label }) => {
    if (!value || value.trim() === '') {
      errors.push(`${label} is required`);
    }
  });
  
  if (errors.length > 0) {
    alert(`⚠️ Please fix the following:\n\n${errors.join('\n')}`);
    return false;
  }
  
  return true;
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
// Company Information Management
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
// Unified Data Fetching
// =========================================
async function fetchAllData() {
  try {
    await Promise.all([
      fetchInventory(),
      fetchSales(),
      fetchPurchases(),
      fetchLogs(),
      fetchCompanyInfo()
    ]);
    
    // Update profit after all data is loaded
    updateProfitCard();
  } catch (error) {
    console.error('Error fetching all data:', error);
  }
}

// =========================================
// PAGINATION FUNCTIONS
// =========================================
function updatePagination(items) {
  const totalItems = items.length;
  totalPages = Math.ceil(totalItems / itemsPerPage);
  
  if (currentPageNumber > totalPages) {
    currentPageNumber = totalPages || 1;
  }
  
  if (qs('#currentPage')) qs('#currentPage').textContent = currentPageNumber;
  if (qs('#totalPages')) qs('#totalPages').textContent = totalPages;
  if (qs('#totalItems')) qs('#totalItems').textContent = totalItems;
  
  const start = ((currentPageNumber - 1) * itemsPerPage) + 1;
  const end = Math.min(currentPageNumber * itemsPerPage, totalItems);
  
  if (qs('#currentPageStart')) qs('#currentPageStart').textContent = start;
  if (qs('#currentPageEnd')) qs('#currentPageEnd').textContent = end;
  
  updatePageNumberButtons();
  updatePaginationButtonStates();
  
  return items.slice(start - 1, end);
}

function updatePageNumberButtons() {
  const pageNumbersContainer = qs('#pageNumbers');
  const pageNumbersFooter = qs('#pageNumbersFooter');
  
  if (!pageNumbersContainer && !pageNumbersFooter) return;
  
  const containers = [pageNumbersContainer, pageNumbersFooter].filter(Boolean);
  
  containers.forEach(container => {
    container.innerHTML = '';
    
    addPageButton(container, 1);
    
    if (currentPageNumber > 3) {
      const ellipsis = document.createElement('span');
      ellipsis.textContent = '...';
      ellipsis.style.padding = '6px';
      container.appendChild(ellipsis);
    }
    
    const startPage = Math.max(2, currentPageNumber - 1);
    const endPage = Math.min(totalPages - 1, currentPageNumber + 1);
    
    for (let i = startPage; i <= endPage; i++) {
      if (i > 1 && i < totalPages) {
        addPageButton(container, i);
      }
    }
    
    if (currentPageNumber < totalPages - 2) {
      const ellipsis = document.createElement('span');
      ellipsis.textContent = '...';
      ellipsis.style.padding = '6px';
      container.appendChild(ellipsis);
    }
    
    if (totalPages > 1) {
      addPageButton(container, totalPages);
    }
  });
}

function addPageButton(container, pageNumber) {
  const button = document.createElement('button');
  button.className = `pagination-btn ${pageNumber === currentPageNumber ? 'active' : ''}`;
  button.textContent = pageNumber;
  button.onclick = () => goToPage(pageNumber);
  container.appendChild(button);
}

function updatePaginationButtonStates() {
  const buttons = {
    first: ['firstPageBtn', 'firstPageBtnFooter'],
    prev: ['prevPageBtn', 'prevPageBtnFooter'],
    next: ['nextPageBtn', 'nextPageBtnFooter'],
    last: ['lastPageBtn', 'lastPageBtnFooter']
  };
  
  Object.entries(buttons).forEach(([type, ids]) => {
    ids.forEach(id => {
      const btn = qs(`#${id}`);
      if (btn) {
        switch(type) {
          case 'first':
          case 'prev':
            btn.disabled = currentPageNumber === 1;
            break;
          case 'next':
          case 'last':
            btn.disabled = currentPageNumber === totalPages;
            break;
        }
      }
    });
  });
}

function goToPage(page) {
  if (page < 1 || page > totalPages || page === currentPageNumber) return;
  currentPageNumber = page;
  renderInventory(filteredInventory);
}

function changeItemsPerPage() {
  const select = qs('#itemsPerPageSelect');
  if (select) {
    itemsPerPage = parseInt(select.value);
    currentPageNumber = 1;
    renderInventory(filteredInventory);
  }
}

function bindPaginationEvents() {
  qs('#firstPageBtn')?.addEventListener('click', () => goToPage(1));
  qs('#firstPageBtnFooter')?.addEventListener('click', () => goToPage(1));
  
  qs('#prevPageBtn')?.addEventListener('click', () => goToPage(currentPageNumber - 1));
  qs('#prevPageBtnFooter')?.addEventListener('click', () => goToPage(currentPageNumber - 1));
  
  qs('#nextPageBtn')?.addEventListener('click', () => goToPage(currentPageNumber + 1));
  qs('#nextPageBtnFooter')?.addEventListener('click', () => goToPage(currentPageNumber + 1));
  
  qs('#lastPageBtn')?.addEventListener('click', () => goToPage(totalPages));
  qs('#lastPageBtnFooter')?.addEventListener('click', () => goToPage(totalPages));
  
  qs('#itemsPerPageSelect')?.addEventListener('change', changeItemsPerPage);
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
    
    filteredInventory = [...inventory];
    renderInventory(filteredInventory);
    renderDashboardData();
  } catch(err) { 
    console.error('Fetch inventory error:', err); 
  }
}

// Unified profit calculation
function updateProfitCard() {
  let calculatedProfit = 0;
  
  // Calculate profit from sales
  if (sales && sales.length > 0) {
    sales.forEach(sale => {
      if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(item => {
          const inventoryItem = inventory.find(i => i.sku === item.sku);
          if (inventoryItem) {
            const unitCost = inventoryItem.unitCost || 0;
            const salePrice = item.salePrice || 0;
            const quantity = item.quantity || 0;
            calculatedProfit += (salePrice - unitCost) * quantity;
          }
        });
      }
      // Also add direct profit if available from API
      if (sale.totalProfit) {
        calculatedProfit += sale.totalProfit;
      }
    });
  }
  
  // Update total profit
  totalProfitEarned = calculatedProfit;
  
  // Update all profit displays
  const profitElements = [
    '#cardTotalProfit',
    '#dash_totalProfit',
    '#totalProfitDisplay'
  ];
  
  profitElements.forEach(selector => {
    if (qs(selector)) {
      qs(selector).textContent = `RM ${totalProfitEarned.toFixed(2)}`;
    }
  });
}

function renderInventory(items) {
  const list = qs('#inventoryList');
  if(!list) return;
  
  const paginatedItems = updatePagination(items);
  
  list.innerHTML = '';
  let totalValue = 0, totalRevenue = 0, totalStock = 0;

  paginatedItems.forEach(it => {
    const id = it.id || it._id;
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const invVal = qty * uc;
    const rev = qty * up;
    
    totalValue += invVal;
    totalRevenue += rev;
    totalStock += qty;

    const date = it.createdAt ? new Date(it.createdAt).toLocaleDateString() : 'N/A';
    
    let statusClass = '';
    let statusText = '';
    if (qty === 0) {
      statusClass = 'status-out-of-stock';
      statusText = 'Out of Stock';
    } else if (qty < 10) {
      statusClass = 'status-low-stock';
      statusText = 'Low Stock';
    } else {
      statusClass = 'status-in-stock';
      statusText = 'In Stock';
    }

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
      <td>${date}</td>
      <td><span class="status-badge ${statusClass}">${statusText}</span></td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditPageForItem('${id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="confirmAndDeleteItem('${id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });

  if(qs('#cardTotalValue')) qs('#cardTotalValue').textContent = `RM ${totalValue.toFixed(2)}`;
  if(qs('#cardTotalRevenue')) qs('#cardTotalRevenue').textContent = `RM ${totalRevenue.toFixed(2)}`;
  updateProfitCard();
  if(qs('#cardTotalStock')) qs('#cardTotalStock').textContent = totalStock;
  if(qs('#cardTotalProducts')) qs('#cardTotalProducts').textContent = items.length;
}

function searchInventory(){
  const textQuery = (qs('#searchInput')?.value || '').toLowerCase().trim();
  const startDate = qs('#startDate')?.value || '';
  const endDate = qs('#endDate')?.value || '';
  
  let filtered = inventory;
  
  if (textQuery) {
    filtered = filtered.filter(item => 
      (item.sku||'').toLowerCase().includes(textQuery) || 
      (item.name||'').toLowerCase().includes(textQuery) || 
      (item.category||'').toLowerCase().includes(textQuery)
    );
  }
  
  if (startDate || endDate) {
    filtered = filtered.filter(item => {
      if (!item.createdAt) return false;
      
      const itemDate = new Date(item.createdAt);
      
      if (startDate && !endDate) {
        const start = new Date(startDate);
        return itemDate >= start;
      }
      
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
  
  filteredInventory = filtered;
  currentPageNumber = 1;
  renderInventory(filtered);
}

// =========================================
// DATE RANGE FILTERING FUNCTIONS
// =========================================
function filterByDateRange(startDate, endDate) {
  if (!startDate && !endDate) {
    filteredInventory = [...inventory];
    renderInventory(filteredInventory);
    updateDateRangeStatus(false);
    return;
  }

  const filtered = inventory.filter(item => {
    if (!item.createdAt) return false;
    
    const itemDate = new Date(item.createdAt);
    
    if (startDate && !endDate) {
      const start = new Date(startDate);
      return itemDate >= start;
    }
    
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
  
  filteredInventory = filtered;
  currentPageNumber = 1;
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
  filteredInventory = [...inventory];
  currentPageNumber = 1;
  renderInventory(filteredInventory);
  updateDateRangeStatus(false);
}

function applyDateRangeFilter() {
  const startDate = qs('#startDate')?.value;
  const endDate = qs('#endDate')?.value;
  
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
  qs('#applyDateRangeBtn')?.addEventListener('click', applyDateRangeFilter);
  
  qs('#clearDateRangeBtn')?.addEventListener('click', clearDateRangeFilter);
  
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
// Sales Management Functions
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
        <button class="success-btn small-btn" onclick="printAndSaveSalesInvoice('${s.id}')">🖨️ Invoice</button>
        <button class="danger-btn small-btn" onclick="deleteSales('${s.id}')">🗑️ Delete</button>
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
    const salesItems = qs('#salesItems');
    if (salesItems) salesItems.innerHTML = '';
    loadProductSearchForSales();
    modal.style.display = 'block';
    updateSalesTotalAmount();
  } else {
    console.error('New sales modal not found');
    alert('Sales modal not found. Please check if the HTML is loaded correctly.');
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
  if (qs('#customerName')) qs('#customerName').value = '';
  if (qs('#customerContact')) qs('#customerContact').value = '';
  if (qs('#salesDate')) qs('#salesDate').value = new Date().toISOString().split('T')[0];
  if (qs('#salesNotes')) qs('#salesNotes').value = '';
  if (qs('#productSearchSales')) qs('#productSearchSales').value = '';
  if (qs('#productResultsSales')) qs('#productResultsSales').innerHTML = '';
  if (qs('#salesItems')) qs('#salesItems').innerHTML = '';
  if (qs('#totalSalesAmount')) qs('#totalSalesAmount').textContent = '0.00';
}

function addSalesProductItem(product = null) {
  const container = qs('#salesItems');
  if (!container) {
    console.error('Sales items container not found');
    return;
  }
  
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
  
  const quantityInput = itemRow.querySelector('.product-quantity');
  const priceInput = itemRow.querySelector('.product-price');
  const totalInput = itemRow.querySelector('.product-total');
  
  const calculateTotal = () => {
    const qty = Number(quantityInput.value) || 0;
    const price = Number(priceInput.value) || 0;
    if (totalInput) {
      totalInput.value = (qty * price).toFixed(2);
    }
    updateSalesTotalAmount();
  };
  
  if (quantityInput) quantityInput.addEventListener('input', calculateTotal);
  if (priceInput) priceInput.addEventListener('input', calculateTotal);
  
  const removeBtn = itemRow.querySelector('.remove-item-btn');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      itemRow.remove();
      updateSalesTotalAmount();
    });
  }
  
  calculateTotal();
}

function updateSalesTotalAmount() {
  let total = 0;
  const itemRows = qsa('#salesItems .sales-item-row');
  
  itemRows.forEach(row => {
    const totalInput = row.querySelector('.product-total');
    if (totalInput) {
      const itemTotal = Number(totalInput.value) || 0;
      total += itemTotal;
    }
  });
  
  if (qs('#totalSalesAmount')) {
    qs('#totalSalesAmount').textContent = total.toFixed(2);
  }
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
  // Validate required fields
  if (!validateRequiredFields([
    { name: 'customer', value: qs('#customerName').value.trim(), label: 'Customer name' },
    { name: 'contact', value: qs('#customerContact').value.trim(), label: 'Customer contact' }
  ])) {
    return;
  }
  
  const customer = qs('#customerName').value.trim();
  const customerContact = qs('#customerContact').value.trim();
  const salesDate = qs('#salesDate').value;
  const notes = qs('#salesNotes').value.trim();
  
  const items = [];
  const itemRows = qsa('.sales-item-row');
  
  if (itemRows.length === 0) {
    alert('⚠️ Please add at least one product item.');
    return;
  }
  
  for (const row of itemRows) {
    const skuInput = row.querySelector('.product-sku');
    const nameInput = row.querySelector('.product-name');
    const quantityInput = row.querySelector('.product-quantity');
    const priceInput = row.querySelector('.product-price');
    
    const sku = skuInput ? skuInput.value.trim() : '';
    const productName = nameInput ? nameInput.value.trim() : '';
    const quantity = quantityInput ? Number(quantityInput.value) : 0;
    const salePrice = priceInput ? Number(priceInput.value) : 0;
    
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
    customerContact,
    salesDate: salesDate || new Date().toISOString().split('T')[0],
    notes,
    items
  };
  
  let confirmMessage = `Confirm Sales Order:\n\nCustomer: ${customer}\nContact: ${customerContact}\nItems: ${items.length}\n\nItems:\n`;
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
      
      // Refresh data
      await fetchInventory();
      await fetchSales();
      
      // Automatically print and save invoice
      await printAndSaveSalesInvoice(savedSales.id);
      
      closeNewSalesModal();
      
    } else {
      const error = await res.json();
      alert(`❌ Failed to save sales order: ${error.message}`);
    }
  } catch (e) {
    console.error('Save sales order error:', e);
    alert('❌ Server connection error while saving sales order.');
  }
}

async function viewSalesDetails(salesId) {
  try {
    const res = await apiFetch(`${API_BASE}/sales/${salesId}`);
    if (!res.ok) throw new Error('Failed to fetch sales details');
    
    const sale = await res.json();
    
    qs('#detailSalesId').textContent = sale.salesId || 'N/A';
    qs('#detailCustomer').textContent = sale.customer || 'N/A';
    qs('#detailCustomerContact').textContent = sale.customerContact || 'N/A';
    qs('#detailSalesDate').textContent = new Date(sale.salesDate).toLocaleDateString();
    qs('#detailSalesTotalAmount').textContent = `RM ${(sale.totalAmount || 0).toFixed(2)}`;
    
    if (sale.notes && sale.notes.trim()) {
      qs('#detailSalesNotes').textContent = sale.notes;
      qs('#detailSalesNotesRow').style.display = 'flex';
    } else {
      qs('#detailSalesNotesRow').style.display = 'none';
    }
    
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
    
    qs('#printSalesInvoiceBtn').onclick = () => printAndSaveSalesInvoice(salesId);
    
    qs('#salesDetailsModal').style.display = 'block';
    
  } catch (e) {
    console.error('View sales details error:', e);
    alert('❌ Failed to load sales details.');
  }
}

function closeSalesDetailsModal() {
  qs('#salesDetailsModal').style.display = 'none';
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
      updateProfitCard();
      alert('🗑️ Sales order deleted!');
    } else {
      alert('❌ Failed to delete sales order.');
    }
  } catch (e) {
    console.error(e);
    alert('❌ Server connection error while deleting sales order.');
  }
}

async function printAndSaveSalesInvoice(salesId) {
  try {
    // Print the invoice
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
    
    // Save to statements/documents
    const saveRes = await apiFetch(`${API_BASE}/sales/save-invoice/${salesId}`, {
      method: 'POST'
    });
    
    if (saveRes.ok) {
      console.log('✅ Invoice saved to documents');
    }
    
  } catch (e) {
    console.error('Print and save invoice error:', e);
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
        <button class="success-btn small-btn" onclick="printAndSavePurchaseInvoice('${p.id}')">🖨️ Invoice</button>
        <button class="danger-btn small-btn" onclick="deletePurchase('${p.id}')">🗑️ Delete</button>
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
    resetPurchaseForm();
    const purchaseItems = qs('#purchaseItems');
    if (purchaseItems) purchaseItems.innerHTML = '';
    loadProductSearch();
    modal.style.display = 'block';
    updateTotalAmount();
  } else {
    console.error('New purchase modal not found');
    alert('Purchase modal not found. Please check if the HTML is loaded correctly.');
  }
}

function closeNewPurchaseModal() {
  const modal = qs('#newPurchaseModal');
  if (modal) {
    modal.style.display = 'none';
    resetPurchaseForm();
  }
}

function resetPurchaseForm() {
  if (qs('#supplierName')) qs('#supplierName').value = '';
  if (qs('#supplierContact')) qs('#supplierContact').value = '';
  if (qs('#purchaseDate')) qs('#purchaseDate').value = new Date().toISOString().split('T')[0];
  if (qs('#purchaseNotes')) qs('#purchaseNotes').value = '';
  if (qs('#productSearch')) qs('#productSearch').value = '';
  if (qs('#productResults')) qs('#productResults').innerHTML = '';
  if (qs('#purchaseItems')) qs('#purchaseItems').innerHTML = '';
  
  if (qs('#totalPurchaseAmount')) {
    qs('#totalPurchaseAmount').textContent = '0.00';
  }
}

function addProductItem(product = null) {
  const container = qs('#purchaseItems');
  if (!container) {
    console.error('Purchase items container not found');
    return;
  }
  
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
  
  const quantityInput = itemRow.querySelector('.product-quantity');
  const priceInput = itemRow.querySelector('.product-price');
  const totalInput = itemRow.querySelector('.product-total');
  
  const calculateTotal = () => {
    const qty = Number(quantityInput.value) || 0;
    const price = Number(priceInput.value) || 0;
    if (totalInput) {
      totalInput.value = (qty * price).toFixed(2);
    }
    updateTotalAmount();
  };
  
  if (quantityInput) quantityInput.addEventListener('input', calculateTotal);
  if (priceInput) priceInput.addEventListener('input', calculateTotal);
  
  const removeBtn = itemRow.querySelector('.remove-item-btn');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      itemRow.remove();
      updateTotalAmount();
    });
  }
  
  calculateTotal();
}

function updateTotalAmount() {
  let newTotal = 0;
  
  const newItemRows = qsa('#purchaseItems .purchase-item-row');
  newItemRows.forEach(row => {
    const totalInput = row.querySelector('.product-total');
    if (totalInput) {
      const itemTotal = Number(totalInput.value) || 0;
      newTotal += itemTotal;
    }
  });
  
  if (qs('#totalPurchaseAmount')) {
    qs('#totalPurchaseAmount').textContent = newTotal.toFixed(2);
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
  // Validate required fields
  if (!validateRequiredFields([
    { name: 'supplier', value: qs('#supplierName').value.trim(), label: 'Supplier name' },
    { name: 'contact', value: qs('#supplierContact').value.trim(), label: 'Supplier contact' }
  ])) {
    return;
  }
  
  const supplier = qs('#supplierName').value.trim();
  const supplierContact = qs('#supplierContact').value.trim();
  const purchaseDate = qs('#purchaseDate').value;
  const notes = qs('#purchaseNotes').value.trim();
  
  const items = [];
  const itemRows = qsa('.purchase-item-row');
  
  if (itemRows.length === 0) {
    alert('⚠️ Please add at least one product item.');
    return;
  }
  
  for (const row of itemRows) {
    const skuInput = row.querySelector('.product-sku');
    const nameInput = row.querySelector('.product-name');
    const quantityInput = row.querySelector('.product-quantity');
    const priceInput = row.querySelector('.product-price');
    
    const sku = skuInput ? skuInput.value.trim() : '';
    const productName = nameInput ? nameInput.value.trim() : '';
    const quantity = quantityInput ? Number(quantityInput.value) : 0;
    const purchasePrice = priceInput ? Number(priceInput.value) : 0;
    
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
    supplierContact,
    purchaseDate: purchaseDate || new Date().toISOString().split('T')[0],
    notes,
    items
  };
  
  let confirmMessage = `Confirm Purchase Order:\n\nSupplier: ${supplier}\nContact: ${supplierContact}\nItems: ${items.length}\n\nItems:\n`;
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
      
      // Refresh data
      await fetchInventory();
      await fetchPurchases();
      
      // Automatically print and save invoice
      await printAndSavePurchaseInvoice(savedPurchase.id);
      
      closeNewPurchaseModal();
      
    } else {
      const error = await res.json();
      alert(`❌ Failed to save purchase order: ${error.message}`);
    }
  } catch (e) {
    console.error('Save purchase order error:', e);
    alert('❌ Server connection error while saving purchase order.');
  }
}

async function viewPurchaseDetails(purchaseId) {
  try {
    const res = await apiFetch(`${API_BASE}/purchases/${purchaseId}`);
    if (!res.ok) throw new Error('Failed to fetch purchase details');
    
    const purchase = await res.json();
    
    qs('#detailPurchaseId').textContent = purchase.purchaseId || 'N/A';
    qs('#detailSupplier').textContent = purchase.supplier || 'N/A';
    qs('#detailSupplierContact').textContent = purchase.supplierContact || 'N/A';
    qs('#detailPurchaseDate').textContent = new Date(purchase.purchaseDate).toLocaleDateString();
    qs('#detailTotalAmount').textContent = `RM ${(purchase.totalAmount || 0).toFixed(2)}`;
    
    if (purchase.notes && purchase.notes.trim()) {
      qs('#detailNotes').textContent = purchase.notes;
      qs('#detailNotesRow').style.display = 'flex';
    } else {
      qs('#detailNotesRow').style.display = 'none';
    }
    
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
    
    qs('#printDetailsInvoiceBtn').onclick = () => printAndSavePurchaseInvoice(purchaseId);
    
    qs('#purchaseDetailsModal').style.display = 'block';
    
  } catch (e) {
    console.error('View purchase details error:', e);
    alert('❌ Failed to load purchase details.');
  }
}

function closePurchaseDetailsModal() {
  qs('#purchaseDetailsModal').style.display = 'none';
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

async function printAndSavePurchaseInvoice(purchaseId) {
  try {
    // Print the invoice
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
    
    // Save to statements/documents
    const saveRes = await apiFetch(`${API_BASE}/purchases/save-invoice/${purchaseId}`, {
      method: 'POST'
    });
    
    if (saveRes.ok) {
      console.log('✅ Purchase invoice saved to documents');
    }
    
  } catch (e) {
    console.error('Print and save invoice error:', e);
    alert('❌ Failed to generate invoice.');
  }
}

// =========================================
// Enhanced Report Generation with Date Range
// =========================================
function openReportModal() {
  const modal = qs('#reportModal');
  if (modal) {
    modal.style.display = 'block';
    qs('#reportStartDate').value = '';
    qs('#reportEndDate').value = '';
    
    qsa('.report-option').forEach(opt => opt.classList.remove('selected'));
    selectReportType('inventory');
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
    
    let filename = 'Inventory_Report';
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate).toISOString().split('T')[0] : 'All';
      const end = endDate ? new Date(endDate).toISOString().split('T')[0] : 'All';
      filename += `_${start}_to_${end}`;
    } else {
      filename += '_Full_List';
    }
    filename += `_${Date.now()}.pdf`;
    
    a.download = filename;
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

// =========================================
// Folder Management for Documents
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
        <button class="info-btn small-btn preview-btn" data-id="${id}" data-name="${escapeHtml(d.name||'')}" title="Preview">👁️ Preview</button>
      </td>
    `;
    list.appendChild(tr);
  });

  bindDocumentEvents();
}

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

function bindDocumentEvents() {
  qsa('.download-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.getAttribute('data-id');
      const name = this.getAttribute('data-name');
      downloadDocument(id, name);
    });
  });

  qsa('.delete-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.getAttribute('data-id');
      deleteDocumentConfirm(id);
    });
  });

  qsa('.preview-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.getAttribute('data-id');
      const name = this.getAttribute('data-name');
      previewDocument(id, name);
    });
  });
}

async function downloadDocument(docId, fileName) {
  if(!confirm(`Confirm Download: ${fileName}?`)) return;
  
  try {
    console.log(`Starting download: ${fileName} (ID: ${docId})`);
    
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

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 100);

    console.log(`Download completed: ${fileName}`);

  } catch (error) {
    console.error('Download error:', error);
    alert(`❌ Download Failed: ${error.message}`);
    
    if (fileName.includes('Inventory_Report') && confirm('This report file appears to be corrupted. Would you like to generate a new one?')) {
      if (fileName.endsWith('.pdf')) {
        generateInventoryReport();
      }
    }
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
// Statements Management
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
  qsa('.tab-button').forEach(btn => btn.classList.remove('active'));
  qs(`#tab-${tabName}`).classList.add('active');
  
  qsa('.tab-content').forEach(content => content.classList.remove('active'));
  qs(`#content-${tabName}`).classList.add('active');
  
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
    let totalValue = 0, totalRevenue = 0, totalStock = 0;
    inventory.forEach(it => {
      const qty = Number(it.quantity || 0);
      const invVal = qty * Number(it.unitCost || 0);
      const rev = qty * Number(it.unitPrice || 0);
      
      totalValue += invVal;
      totalRevenue += rev;
      totalStock += qty;
    });
    qs('#dash_totalItems').textContent = inventory.length;
    
    if(qs('#dash_totalValue')) qs('#dash_totalValue').textContent = `RM ${totalValue.toFixed(2)}`;
    if(qs('#dash_totalRevenue')) qs('#dash_totalRevenue').textContent = `RM ${totalRevenue.toFixed(2)}`;
    if(qs('#dash_totalStock')) qs('#dash_totalStock').textContent = totalStock;
    
    // Update profit using the unified function
    updateProfitCard();
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
  console.log('Purchase edit page binding');
}

function bindSalesEditPage() {
  console.log('Sales edit page binding');
}

// =========================================
// Scroll to Add New Product Form
// =========================================
function scrollToAddProductForm() {
  const addProductSection = qs('#addProductSection');
  if (addProductSection) {
    addProductSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    setTimeout(() => {
      const firstInput = qs('#p_sku');
      if (firstInput) {
        firstInput.focus();
      }
    }, 500);
  }
}

// =========================================
// ENHANCED UI BINDING - FIXED
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
  
  qs('#addNewProductBtn')?.addEventListener('click', scrollToAddProductForm);
  
  // Purchase buttons - FIXED: Using direct function calls
  qs('#purchaseHistoryBtn')?.addEventListener('click', openPurchaseHistoryModal);
  qs('#newPurchaseBtn')?.addEventListener('click', openNewPurchaseModal);
  
  // Sales buttons - FIXED: Using direct function calls
  qs('#salesHistoryBtn')?.addEventListener('click', openSalesHistoryModal);
  qs('#newSalesBtn')?.addEventListener('click', openNewSalesModal);
  
  // Other modal bindings
  qs('#addProductItem')?.addEventListener('click', () => addProductItem());
  qs('#savePurchaseBtn')?.addEventListener('click', savePurchaseOrder);
  qs('#closePurchaseModal')?.addEventListener('click', closeNewPurchaseModal);
  
  qs('#addSalesProductItem')?.addEventListener('click', () => addSalesProductItem());
  qs('#saveSalesBtn')?.addEventListener('click', saveSalesOrder);
  qs('#closeSalesModal')?.addEventListener('click', closeNewSalesModal);
  
  qs('#generateReportBtn')?.addEventListener('click', generateSelectedReport);
  qs('#closeReportModal')?.addEventListener('click', closeReportModal);
  
  qs('#closeStatementsModal')?.addEventListener('click', closeStatementsModal);
  
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
  
  bindDateRangeFilterEvents();
  bindPaginationEvents();
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
    // Fetch all data in parallel for better performance
    await fetchAllData();
    
    // Bind UI based on current page
    if(currentPage.includes('inventory') || currentPage === '' || currentPage === 'index.html') { 
      bindInventoryUI(); 
    }
    if(currentPage.includes('documents')) { 
      await fetchFolders();
      await fetchDocuments(); 
      bindDocumentsUI(); 
    }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
    if(currentPage.includes('purchase-edit')) bindPurchaseEditPage();
    if(currentPage.includes('sales-edit')) bindSalesEditPage();
  } catch(e) { 
    console.error('Init error', e); 
    alert('Error loading data. Please refresh the page.');
  }
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

function showCardTooltip(message) {
  // Simple alert for now
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
window.cleanupCorruptedDocuments = cleanupCorruptedDocuments;
window.showCardTooltip = showCardTooltip;

window.openPurchaseHistoryModal = openPurchaseHistoryModal;
window.closePurchaseHistoryModal = closePurchaseHistoryModal;
window.openNewPurchaseModal = openNewPurchaseModal;
window.closeNewPurchaseModal = closeNewPurchaseModal;
window.savePurchaseOrder = savePurchaseOrder;
window.printAndSavePurchaseInvoice = printAndSavePurchaseInvoice;
window.deletePurchase = deletePurchase;
window.viewPurchaseDetails = viewPurchaseDetails;
window.closePurchaseDetailsModal = closePurchaseDetailsModal;

window.openSalesHistoryModal = openSalesHistoryModal;
window.closeSalesHistoryModal = closeSalesHistoryModal;
window.openNewSalesModal = openNewSalesModal;
window.closeNewSalesModal = closeNewSalesModal;
window.saveSalesOrder = saveSalesOrder;
window.printAndSaveSalesInvoice = printAndSaveSalesInvoice;
window.deleteSales = deleteSales;
window.viewSalesDetails = viewSalesDetails;
window.closeSalesDetailsModal = closeSalesDetailsModal;

window.openReportModal = openReportModal;
window.selectReportType = selectReportType;
window.generateSelectedReport = generateSelectedReport;

window.openStatementsModal = openStatementsModal;
window.switchTab = switchTab;
window.previewDocument = previewDocument;
window.closePreviewModal = closePreviewModal;

window.createFolder = createFolder;
window.renameFolder = renameFolder;
window.deleteFolder = deleteFolder;
window.navigateToFolder = navigateToFolder;

window.updateCompanyInfo = updateCompanyInfo;

window.login = login;
window.register = register;
window.toggleForm = toggleForm;
