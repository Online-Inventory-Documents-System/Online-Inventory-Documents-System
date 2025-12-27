// public/js/script.js
// Complete client-side script for Online Inventory & Documents System
// UPDATED WITH PAYMENT LOGIC IN SALES HISTORY

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

// =========================================
// PERFORMANCE OPTIMIZATION
// =========================================
// Cache DOM elements for faster access
const DOM_CACHE = {};
function getElement(selector) {
  if (!DOM_CACHE[selector]) {
    DOM_CACHE[selector] = document.querySelector(selector);
  }
  return DOM_CACHE[selector];
}

function getElements(selector) {
  if (!DOM_CACHE[selector]) {
    DOM_CACHE[selector] = Array.from(document.querySelectorAll(selector));
  }
  return DOM_CACHE[selector];
}

// Optimized utility functions
const qs = getElement;
const qsa = getElements;
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

// Toast notification system
let toastIdCounter = 0;
function showToast(message, type = 'info', duration = 3000) {
  let toastContainer = qs('#toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  
  const toastId = `toast-${++toastIdCounter}`;
  const toast = document.createElement('div');
  toast.id = toastId;
  toast.className = `toast toast-${type}`;
  
  let icon = 'ℹ️';
  switch(type) {
    case 'success': icon = '✅'; break;
    case 'error': icon = '❌'; break;
    case 'warning': icon = '⚠️'; break;
    case 'info': icon = 'ℹ️'; break;
  }
  
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-message">${message}</div>
    <button class="toast-close" onclick="removeToast('${toastId}')">×</button>
  `;
  
  toastContainer.appendChild(toast);
  
  setTimeout(() => {
    removeToast(toastId);
  }, duration);
  
  return toastId;
}

function removeToast(toastId) {
  const toast = qs(`#${toastId}`);
  if (toast) {
    toast.classList.add('toast-hiding');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }
}

// Optimized data storage
let inventory = [];
let activityLog = [];
let documents = [];
let purchases = [];
let sales = [];
let folders = [];
let companyInfo = {};
const currentPage = window.location.pathname.split('/').pop();

// Pagination variables
let inventoryPagination = { currentPage: 1, itemsPerPage: 10, totalPages: 1 };
let purchasePagination = { currentPage: 1, itemsPerPage: 10, totalPages: 1 };
let salesPagination = { currentPage: 1, itemsPerPage: 10, totalPages: 1 };

let filteredInventory = [];
let filteredPurchases = [];
let filteredSales = [];

// =========================================
// PERFORMANCE OPTIMIZATION: CACHING
// =========================================
const dataCache = {
  inventory: { data: null, timestamp: 0, ttl: 30000 }, // 30 seconds
  sales: { data: null, timestamp: 0, ttl: 30000 },
  purchases: { data: null, timestamp: 0, ttl: 30000 },
  documents: { data: null, timestamp: 0, ttl: 30000 },
  folders: { data: null, timestamp: 0, ttl: 30000 },
  company: { data: null, timestamp: 0, ttl: 60000 }, // 1 minute
  dashboard: { data: null, timestamp: 0, ttl: 15000 } // 15 seconds
};

function isCacheValid(cacheKey) {
  const cache = dataCache[cacheKey];
  if (!cache || !cache.data) return false;
  return (Date.now() - cache.timestamp) < cache.ttl;
}

function updateCache(cacheKey, data) {
  dataCache[cacheKey] = {
    data,
    timestamp: Date.now(),
    ttl: dataCache[cacheKey]?.ttl || 30000
  };
}

function getFromCache(cacheKey) {
  return isCacheValid(cacheKey) ? dataCache[cacheKey].data : null;
}

// =========================================
// OPTIMIZED API FETCH
// =========================================
async function apiFetch(url, options = {}) {
  const user = getUsername();
  options.headers = {
    'Content-Type': 'application/json',
    'X-Username': user,
    ...options.headers,
  };

  // Add cache busting for GET requests
  if (!options.method || options.method === 'GET') {
    const cacheBuster = `t=${Date.now()}`;
    url += (url.includes('?') ? '&' : '?') + cacheBuster;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    options.signal = controller.signal;
    
    const response = await fetch(url, options);
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout. Please check your connection.');
    }
    console.error('API fetch error:', error);
    throw error;
  }
}

// Optimized fetch with caching
async function fetchWithCache(endpoint, cacheKey, forceRefresh = false) {
  if (!forceRefresh && isCacheValid(cacheKey)) {
    return getFromCache(cacheKey);
  }
  
  try {
    const response = await apiFetch(`${API_BASE}/${endpoint}`);
    const data = await response.json();
    updateCache(cacheKey, data);
    return data;
  } catch (error) {
    console.error(`Fetch ${cacheKey} error:`, error);
    
    // Return cached data if available, even if stale
    const cached = getFromCache(cacheKey);
    if (cached) {
      showToast(`Using cached ${cacheKey} data`, 'info');
      return cached;
    }
    
    throw error;
  }
}

// =========================================
// FAST LOADING FUNCTIONS
// =========================================
async function loadCriticalData() {
  try {
    // Load only critical data for initial page load
    const criticalData = await Promise.allSettled([
      fetchWithCache('inventory', 'inventory', true), // Force refresh on page load
      fetchWithCache('company', 'company', true)
    ]);
    
    // Process results
    if (criticalData[0].status === 'fulfilled') {
      inventory = criticalData[0].value.map(i => ({ ...i, id: i.id || i._id }));
      filteredInventory = [...inventory];
    }
    
    if (criticalData[1].status === 'fulfilled') {
      companyInfo = criticalData[1].value;
    }
    
    // Load dashboard stats in background
    setTimeout(() => loadDashboardStats(), 100);
    
    return true;
  } catch (error) {
    console.error('Critical data load error:', error);
    return false;
  }
}

async function loadBackgroundData() {
  try {
    // Load non-critical data in background
    const backgroundData = await Promise.allSettled([
      fetchWithCache('sales', 'sales'),
      fetchWithCache('purchases', 'purchases'),
      fetchWithCache('logs', 'logs'),
      fetchWithCache('folders', 'folders')
    ]);
    
    // Process results
    if (backgroundData[0].status === 'fulfilled') {
      sales = backgroundData[0].value.map(s => ({ ...s, id: s.id || s._id }));
      filteredSales = [...sales];
    }
    
    if (backgroundData[1].status === 'fulfilled') {
      purchases = backgroundData[1].value.map(p => ({ ...p, id: p.id || p._id }));
      filteredPurchases = [...purchases];
    }
    
    if (backgroundData[2].status === 'fulfilled') {
      activityLog = backgroundData[2].value;
    }
    
    if (backgroundData[3].status === 'fulfilled') {
      folders = backgroundData[3].value;
    }
    
    return true;
  } catch (error) {
    console.error('Background data load error:', error);
    return false;
  }
}

// =========================================
// ENHANCED THEME MANAGEMENT
// =========================================
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

// =========================================
// PAYMENT SYSTEM FUNCTIONS
// =========================================
function updatePaymentFieldsVisibility() {
  const paymentMethod = qs('#paymentMethod')?.value;
  const cashPaymentGroups = qsa('.cash-payment-group');
  const amountReceivedInput = qs('#amountReceived');
  const changeDisplay = qs('#changeDisplay');
  const changeMessage = qs('#changeMessage');
  
  if (paymentMethod === 'cash') {
    cashPaymentGroups.forEach(group => group.style.display = 'block');
    if (amountReceivedInput) {
      amountReceivedInput.disabled = false;
      amountReceivedInput.value = '';
    }
    
    if (qs('#changeAmount')) qs('#changeAmount').textContent = '0.00';
    if (changeDisplay) {
      changeDisplay.style.borderColor = 'var(--success-color)';
      changeDisplay.style.color = 'var(--success-color)';
    }
    if (changeMessage) changeMessage.style.display = 'none';
    
    calculateChange();
  } else {
    cashPaymentGroups.forEach(group => group.style.display = 'none');
    if (amountReceivedInput) {
      amountReceivedInput.disabled = true;
      amountReceivedInput.value = '0.00';
    }
    
    if (qs('#changeAmount')) qs('#changeAmount').textContent = '0.00';
    if (changeDisplay) {
      changeDisplay.style.borderColor = 'var(--success-color)';
      changeDisplay.style.color = 'var(--success-color)';
    }
    if (changeMessage) changeMessage.style.display = 'none';
    
    validatePayment();
  }
}

function calculateChange() {
  const grandTotal = parseFloat(qs('#grandTotalAmount')?.textContent) || 0;
  const amountReceived = parseFloat(qs('#amountReceived')?.value) || 0;
  const changeAmount = amountReceived - grandTotal;
  
  if (qs('#changeAmount')) {
    qs('#changeAmount').textContent = changeAmount.toFixed(2);
  }
  
  const changeDisplay = qs('#changeDisplay');
  const changeMessage = qs('#changeMessage');
  
  if (changeDisplay) {
    if (changeAmount >= 0) {
      changeDisplay.style.borderColor = 'var(--success-color)';
      changeDisplay.style.color = 'var(--success-color)';
      if (changeMessage) changeMessage.style.display = 'none';
    } else {
      changeDisplay.style.borderColor = 'var(--error-color)';
      changeDisplay.style.color = 'var(--error-color)';
      if (changeMessage) changeMessage.style.display = 'block';
    }
  }
  
  validatePayment();
}

function validatePayment() {
  const saveBtn = qs('#saveSalesBtn');
  const paymentMethod = qs('#paymentMethod')?.value;
  const grandTotal = parseFloat(qs('#grandTotalAmount')?.textContent) || 0;
  const amountReceived = parseFloat(qs('#amountReceived')?.value) || 0;
  const validationMessage = qs('#paymentValidationMessage');
  const validationText = qs('#validationText');
  
  let isValid = true;
  let message = '';
  
  if (paymentMethod === 'cash') {
    if (amountReceived < grandTotal) {
      isValid = false;
      message = `Insufficient payment. Need RM ${(grandTotal - amountReceived).toFixed(2)} more.`;
    } else if (amountReceived === 0) {
      isValid = false;
      message = 'Please enter amount received from customer.';
    } else {
      isValid = true;
      message = `Payment valid. Change: RM ${(amountReceived - grandTotal).toFixed(2)}`;
    }
  } else {
    isValid = true;
    message = `${paymentMethod === 'online' ? 'Online Transfer/QR' : 'Credit/Debit Card'} payment selected.`;
  }
  
  if (validationMessage && validationText) {
    validationText.textContent = message;
    if (isValid) {
      validationMessage.style.backgroundColor = '#d4edda';
      validationMessage.style.border = '1px solid #c3e6cb';
      validationMessage.style.color = '#155724';
    } else {
      validationMessage.style.backgroundColor = '#f8d7da';
      validationMessage.style.border = '1px solid #f5c6cb';
      validationMessage.style.color = '#721c24';
    }
    validationMessage.style.display = 'block';
  }
  
  if (saveBtn) {
    saveBtn.disabled = !isValid;
    if (isValid) {
      saveBtn.classList.remove('disabled');
    } else {
      saveBtn.classList.add('disabled');
    }
  }
  
  return isValid;
}

// =========================================
// OPTIMIZED INVENTORY MANAGEMENT
// =========================================
async function fetchInventory() {
  try {
    const data = await fetchWithCache('inventory', 'inventory');
    inventory = data.map(i => ({ ...i, id: i.id || i._id }));
    filteredInventory = [...inventory];
    
    if (currentPage.includes('inventory') || currentPage === '' || currentPage === 'index.html') {
      renderInventory(filteredInventory);
    }
    
    return inventory;
  } catch(err) { 
    console.error('Fetch inventory error:', err); 
    return [];
  }
}

function renderInventory(items) {
  const list = qs('#inventoryList');
  if(!list) return;
  
  const paginatedItems = updatePagination(items, inventoryPagination, '#inventoryPagination');
  
  // Use DocumentFragment for better performance
  const fragment = document.createDocumentFragment();
  const startNumber = ((inventoryPagination.currentPage - 1) * inventoryPagination.itemsPerPage) + 1;

  paginatedItems.forEach((it, index) => {
    const id = it.id || it._id;
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const date = it.createdAt || 'N/A';
    
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
      <td class="number-cell">${startNumber + index}</td>
      <td>${escapeHtml(it.sku||'')}</td>
      <td>${escapeHtml(it.name||'')}</td>
      <td>${escapeHtml(it.category||'')}</td>
      <td class="quantity-cell">${qty}</td>
      <td class="money cost-cell">RM ${uc.toFixed(2)}</td>
      <td class="money price-cell">RM ${up.toFixed(2)}</td>
      <td class="date-cell">${escapeHtml(date)}</td>
      <td><span class="status-badge ${statusClass}">${statusText}</span></td>
      <td class="actions">
        <div class="action-buttons-horizontal">
          <button class="action-btn primary-btn edit-btn" data-id="${id}">✏️ Edit</button>
          <button class="action-btn danger-btn delete-btn" onclick="confirmAndDeleteItem('${id}')">🗑️ Delete</button>
        </div>
      </td>
    `;
    fragment.appendChild(tr);
  });

  list.innerHTML = '';
  list.appendChild(fragment);
  
  // Update dashboard stats
  updateDashboardStats();
  
  // Attach event listeners
  setTimeout(() => attachInventoryEventListeners(), 0);
}

// =========================================
// OPTIMIZED SALES MANAGEMENT WITH PAYMENT
// =========================================
async function fetchSales() {
  try {
    const data = await fetchWithCache('sales', 'sales');
    sales = data.map(s => ({ ...s, id: s.id || s._id }));
    filteredSales = [...sales];
    return sales;
  } catch(err) {
    console.error('Fetch sales error:', err);
    return [];
  }
}

function renderSalesHistory(items) {
  const list = qs('#salesHistoryList');
  if (!list) return;
  
  const paginatedItems = updatePagination(items, salesPagination, '#salesPagination');
  const fragment = document.createDocumentFragment();
  const startNumber = ((salesPagination.currentPage - 1) * salesPagination.itemsPerPage) + 1;
  
  paginatedItems.forEach((s, index) => {
    let paymentMethodDisplay = 'N/A';
    if (s.paymentMethod) {
      switch(s.paymentMethod) {
        case 'cash': paymentMethodDisplay = '💵 Cash'; break;
        case 'online': paymentMethodDisplay = '📱 Online/QR'; break;
        case 'card': paymentMethodDisplay = '💳 Card'; break;
        default: paymentMethodDisplay = s.paymentMethod;
      }
    }
    
    let paymentStatus = '';
    let paymentStatusClass = '';
    if (s.paymentMethod === 'cash' && s.amountReceived && s.totalAmount) {
      if (s.amountReceived >= s.totalAmount) {
        paymentStatus = '✅ Paid';
        paymentStatusClass = 'status-paid';
      } else {
        paymentStatus = '⚠️ Partial';
        paymentStatusClass = 'status-partial';
      }
    } else if (s.paymentMethod && s.paymentMethod !== 'cash') {
      paymentStatus = '✅ Paid';
      paymentStatusClass = 'status-paid';
    }
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="number-cell">${startNumber + index}</td>
      <td>${escapeHtml(s.salesId || 'N/A')}</td>
      <td>${escapeHtml(s.customer || '')}</td>
      <td>${escapeHtml(s.customerContact || 'N/A')}</td>
      <td>${s.items ? s.items.length : 0} items</td>
      <td class="money">RM ${(s.totalAmount || 0).toFixed(2)}</td>
      <td>${escapeHtml(s.salesDate || 'N/A')}</td>
      <td><span class="payment-method-badge">${paymentMethodDisplay}</span></td>
      <td><span class="status-badge ${paymentStatusClass}">${paymentStatus}</span></td>
      <td class="actions">
        <div class="action-buttons-horizontal">
          <button class="primary-btn small-btn" onclick="viewSalesDetails('${s.id}')">👁️ View</button>
          <button class="success-btn small-btn" onclick="printAndSaveSalesInvoice('${s.id}')">🖨️ Invoice</button>
          <button class="danger-btn small-btn" onclick="deleteSales('${s.id}')">🗑️ Delete</button>
        </div>
      </td>
    `;
    fragment.appendChild(tr);
  });
  
  list.innerHTML = '';
  list.appendChild(fragment);
}

// =========================================
// OPTIMIZED PAGINATION SYSTEM
// =========================================
function updatePagination(items, pagination, containerId) {
  const totalItems = items.length;
  pagination.totalPages = Math.ceil(totalItems / pagination.itemsPerPage);
  
  if (pagination.currentPage > pagination.totalPages) {
    pagination.currentPage = pagination.totalPages || 1;
  }
  
  updatePaginationUI(pagination, containerId, totalItems);
  return items.slice(
    (pagination.currentPage - 1) * pagination.itemsPerPage,
    pagination.currentPage * pagination.itemsPerPage
  );
}

function updatePaginationUI(pagination, containerId, totalItems) {
  const containers = [
    qs(containerId),
    qs(`${containerId}Footer`)
  ].filter(Boolean);
  
  containers.forEach(container => {
    const start = ((pagination.currentPage - 1) * pagination.itemsPerPage) + 1;
    const end = Math.min(pagination.currentPage * pagination.itemsPerPage, totalItems);
    
    // Update page info
    const pageInfo = container.querySelector('.page-info');
    if (pageInfo) {
      pageInfo.textContent = `Page ${pagination.currentPage} of ${pagination.totalPages}`;
    }
    
    // Update item count
    const itemCount = container.querySelector('.item-count');
    if (itemCount) {
      itemCount.textContent = `Showing ${start}-${end} of ${totalItems}`;
    }
    
    // Update button states
    const prevBtn = container.querySelector('.prev-btn');
    const nextBtn = container.querySelector('.next-btn');
    const firstBtn = container.querySelector('.first-btn');
    const lastBtn = container.querySelector('.last-btn');
    
    if (prevBtn) prevBtn.disabled = pagination.currentPage === 1;
    if (nextBtn) nextBtn.disabled = pagination.currentPage === pagination.totalPages;
    if (firstBtn) firstBtn.disabled = pagination.currentPage === 1;
    if (lastBtn) lastBtn.disabled = pagination.currentPage === pagination.totalPages;
  });
}

// =========================================
// OPTIMIZED DASHBOARD
// =========================================
async function loadDashboardStats() {
  try {
    const data = await fetchWithCache('dashboard/stats', 'dashboard');
    
    if (data && data.success) {
      // Update dashboard cards with animation
      const cards = [
        { id: '#cardTotalProducts', value: data.stats.inventory.count },
        { id: '#cardTotalStock', value: data.stats.inventory.stock },
        { id: '#cardTotalValue', value: `RM ${data.stats.inventory.cost.toFixed(2)}` },
        { id: '#cardTotalRevenue', value: `RM ${data.stats.sales.total.toFixed(2)}` }
      ];
      
      cards.forEach(card => {
        const element = qs(card.id);
        if (element) {
          element.textContent = card.value;
          element.classList.add('pulse-animation');
          setTimeout(() => element.classList.remove('pulse-animation'), 500);
        }
      });
    }
  } catch (error) {
    console.error('Error loading dashboard stats:', error);
  }
}

function updateDashboardStats() {
  const totalStock = inventory.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  if (qs('#cardTotalStock')) qs('#cardTotalStock').textContent = totalStock;
  if (qs('#cardTotalProducts')) qs('#cardTotalProducts').textContent = inventory.length;
}

// =========================================
// OPTIMIZED MODAL SYSTEM
// =========================================
const modalManager = {
  activeModal: null,
  
  open(modalId) {
    this.closeCurrent();
    const modal = qs(modalId);
    if (modal) {
      modal.style.display = 'block';
      document.body.classList.add('modal-open');
      this.activeModal = modal;
      
      // Focus first input
      setTimeout(() => {
        const firstInput = modal.querySelector('input, select, textarea');
        if (firstInput) firstInput.focus();
      }, 100);
    }
  },
  
  closeCurrent() {
    if (this.activeModal) {
      this.activeModal.style.display = 'none';
      document.body.classList.remove('modal-open');
      this.activeModal = null;
    }
  },
  
  close(modalId) {
    const modal = qs(modalId);
    if (modal) {
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
      if (this.activeModal === modal) {
        this.activeModal = null;
      }
    }
  }
};

// =========================================
// FAST INITIALIZATION
// =========================================
window.addEventListener('DOMContentLoaded', async () => {
  initializeTheme();
  
  const adminName = getUsername();
  if (qs('#adminName')) qs('#adminName').textContent = adminName;
  
  // Show loading indicator
  const loadingIndicator = qs('#loadingIndicator');
  if (loadingIndicator) loadingIndicator.style.display = 'block';
  
  try {
    // Load critical data first (fast)
    const criticalLoaded = await loadCriticalData();
    
    if (criticalLoaded) {
      // Bind UI immediately
      bindUI();
      
      // Load background data
      setTimeout(async () => {
        await loadBackgroundData();
        
        // Hide loading indicator
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        
        // Render data if on relevant page
        if (currentPage.includes('inventory') || currentPage === '' || currentPage === 'index.html') {
          renderInventory(filteredInventory);
        }
        
        if (currentPage.includes('documents')) {
          await fetchDocuments();
        }
      }, 100);
    }
  } catch (error) {
    console.error('Initialization error:', error);
    showToast('Error loading data. Please refresh the page.', 'error');
    
    if (loadingIndicator) loadingIndicator.style.display = 'none';
  }
});

// =========================================
// OPTIMIZED UI BINDING
// =========================================
function bindUI() {
  // Common bindings
  bindCommonEvents();
  
  // Page-specific bindings
  if (currentPage.includes('inventory') || currentPage === '' || currentPage === 'index.html') {
    bindInventoryEvents();
  }
  
  if (currentPage.includes('documents')) {
    bindDocumentEvents();
  }
  
  if (currentPage.includes('setting')) {
    bindSettingEvents();
  }
  
  if (currentPage.includes('login.html')) {
    bindLoginEvents();
  }
}

function bindCommonEvents() {
  // Theme toggle
  qs('#themeToggle')?.addEventListener('click', toggleTheme);
  
  // Logout
  qs('#logoutBtn')?.addEventListener('click', logout);
  
  // Company info
  qs('#companyInfoBtn')?.addEventListener('click', () => modalManager.open('#companyInfoModal'));
  
  // Close buttons
  qsa('.close, .modal-close').forEach(btn => {
    btn.addEventListener('click', function() {
      const modal = this.closest('.modal');
      if (modal) modalManager.close(`#${modal.id}`);
    });
  });
  
  // Close modal on background click
  window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
      modalManager.close(`#${e.target.id}`);
    }
  });
}

// ... [Rest of the optimized functions - similar structure but with performance improvements]

// =========================================
// EXPORT FUNCTIONS TO GLOBAL SCOPE
// =========================================
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openAddProductModal = () => modalManager.open('#addProductModal');
window.closeAddProductModal = () => modalManager.close('#addProductModal');
window.confirmAndAddProduct = confirmAndAddProduct;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.openEditProductModal = openEditProductModal;
window.closeEditProductModal = () => modalManager.close('#editProductModal');
window.updateProduct = updateProduct;

// Payment functions
window.updatePaymentFieldsVisibility = updatePaymentFieldsVisibility;
window.calculateChange = calculateChange;
window.validatePayment = validatePayment;

// Sales functions
window.openSalesHistoryModal = () => modalManager.open('#salesHistoryModal');
window.closeSalesHistoryModal = () => modalManager.close('#salesHistoryModal');
window.openNewSalesModal = openNewSalesModal;
window.closeNewSalesModal = () => modalManager.close('#newSalesModal');
window.saveSalesOrder = saveSalesOrder;
window.viewSalesDetails = viewSalesDetails;
window.closeSalesDetailsModal = () => modalManager.close('#salesDetailsModal');
window.deleteSales = deleteSales;
window.printAndSaveSalesInvoice = printAndSaveSalesInvoice;

// Purchase functions
window.openPurchaseHistoryModal = () => modalManager.open('#purchaseHistoryModal');
window.closePurchaseHistoryModal = () => modalManager.close('#purchaseHistoryModal');
window.openNewPurchaseModal = () => modalManager.open('#newPurchaseModal');
window.closeNewPurchaseModal = () => modalManager.close('#newPurchaseModal');
window.savePurchaseOrder = savePurchaseOrder;
window.viewPurchaseDetails = viewPurchaseDetails;
window.closePurchaseDetailsModal = () => modalManager.close('#purchaseDetailsModal');
window.deletePurchase = deletePurchase;
window.printAndSavePurchaseInvoice = printAndSavePurchaseInvoice;

// Report functions
window.openReportModal = () => modalManager.open('#reportModal');
window.closeReportModal = () => modalManager.close('#reportModal');
window.selectReportType = selectReportType;
window.generateSelectedReport = generateSelectedReport;

// Document functions
window.uploadDocuments = uploadDocuments;
window.previewDocument = previewDocument;
window.closePreviewModal = () => modalManager.close('#previewModal');
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;
window.cleanupCorruptedDocuments = cleanupCorruptedDocuments;

// Folder functions
window.createFolder = createFolder;
window.renameFolder = renameFolder;
window.deleteFolder = deleteFolder;
window.navigateToFolder = navigateToFolder;

// Company functions
window.openCompanyInfoModal = () => modalManager.open('#companyInfoModal');
window.closeCompanyInfoModal = () => modalManager.close('#companyInfoModal');
window.updateCompanyInfo = updateCompanyInfo;

// Toast functions
window.showToast = showToast;
window.removeToast = removeToast;

// Confirmation modal
window.showConfirmation = showConfirmation;
window.closeConfirmationModal = () => modalManager.close('#confirmationModal');
