// public/js/script.js
// Complete client-side script for Online Inventory & Documents System
// UPDATED WITH PAYMENT LOGIC IN SALES HISTORY

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

// Utilities
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

// Toast notification system
let toastIdCounter = 0;
function showToast(message, type = 'info', duration = 3000) {
  // Create toast container if it doesn't exist
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
  
  // Set icon based on type
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
  
  // Auto remove after duration
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

let inventory = [];
let activityLog = [];
let documents = [];
let purchases = [];
let sales = [];
let folders = [];
let currentFolder = 'root';
let companyInfo = {};
const currentPage = window.location.pathname.split('/').pop();

// Pagination variables for inventory
let currentPageNumber = 1;
let itemsPerPage = 10;
let totalPages = 1;
let filteredInventory = [];

// Pagination variables for purchases
let currentPurchasePage = 1;
let purchaseItemsPerPage = 10;
let purchaseTotalPages = 1;
let filteredPurchases = [];

// Pagination variables for sales
let currentSalesPage = 1;
let salesItemsPerPage = 10;
let salesTotalPages = 1;
let filteredSales = [];

// Total net profit
let totalNetProfit = 0;

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
    showToast(`Please fix the following:\n\n${errors.join('\n')}`, 'warning', 5000);
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
// NEW: Payment Logic Functions
// =========================================

// Function to update payment fields visibility based on payment method
function updatePaymentFieldsVisibility() {
  const paymentMethod = qs('#paymentMethod').value;
  const cashPaymentGroups = qsa('.cash-payment-group');
  const amountReceivedInput = qs('#amountReceived');
  const changeDisplay = qs('#changeDisplay');
  const changeMessage = qs('#changeMessage');
  
  if (paymentMethod === 'cash') {
    // Show cash payment fields
    cashPaymentGroups.forEach(group => group.style.display = 'block');
    if (amountReceivedInput) amountReceivedInput.disabled = false;
    if (amountReceivedInput) amountReceivedInput.value = '';
    
    // Reset change display
    if (qs('#changeAmount')) qs('#changeAmount').textContent = '0.00';
    if (changeDisplay) {
      changeDisplay.style.borderColor = 'var(--success-color)';
      changeDisplay.style.color = 'var(--success-color)';
    }
    if (changeMessage) changeMessage.style.display = 'none';
    
    // Recalculate change
    calculateChange();
  } else {
    // Hide cash payment fields for online/credit card payments
    cashPaymentGroups.forEach(group => group.style.display = 'none');
    if (amountReceivedInput) amountReceivedInput.disabled = true;
    if (amountReceivedInput) amountReceivedInput.value = '0.00';
    
    // Set change to 0
    if (qs('#changeAmount')) qs('#changeAmount').textContent = '0.00';
    if (changeDisplay) {
      changeDisplay.style.borderColor = 'var(--success-color)';
      changeDisplay.style.color = 'var(--success-color)';
    }
    if (changeMessage) changeMessage.style.display = 'none';
    
    // Validate payment for non-cash methods (always valid)
    validatePayment();
  }
}

// Function to calculate change
function calculateChange() {
  const grandTotal = parseFloat(qs('#grandTotalAmount').textContent) || 0;
  const amountReceived = parseFloat(qs('#amountReceived').value) || 0;
  const changeAmount = amountReceived - grandTotal;
  
  // Update change display
  if (qs('#changeAmount')) {
    qs('#changeAmount').textContent = changeAmount.toFixed(2);
  }
  
  // Update change display style based on validation
  const changeDisplay = qs('#changeDisplay');
  const changeMessage = qs('#changeMessage');
  
  if (changeDisplay) {
    if (changeAmount >= 0) {
      // Sufficient payment
      changeDisplay.style.borderColor = 'var(--success-color)';
      changeDisplay.style.color = 'var(--success-color)';
      if (changeMessage) changeMessage.style.display = 'none';
    } else {
      // Insufficient payment
      changeDisplay.style.borderColor = 'var(--error-color)';
      changeDisplay.style.color = 'var(--error-color)';
      if (changeMessage) changeMessage.style.display = 'block';
    }
  }
  
  // Validate payment
  validatePayment();
}

// Function to validate payment and enable/disable save button
function validatePayment() {
  const saveBtn = qs('#saveSalesBtn');
  const paymentMethod = qs('#paymentMethod').value;
  const grandTotal = parseFloat(qs('#grandTotalAmount').textContent) || 0;
  const amountReceived = parseFloat(qs('#amountReceived').value) || 0;
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
    // Online/Card payments are always valid
    isValid = true;
    message = `${paymentMethod === 'online' ? 'Online Transfer/QR' : 'Credit/Debit Card'} payment selected.`;
  }
  
  // Update validation message
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
  
  // Enable/disable save button
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
// NEW: Add Product Modal Functions - UPDATED: No Scroll
// =========================================
function openAddProductModal() {
  // First, scroll to the inventory table
  const inventoryTitle = qs('#currentInventoryTitle');
  if (inventoryTitle) {
    inventoryTitle.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'start' 
    });
  }
  
  // Then open the modal
  const modal = qs('#addProductModal');
  if (modal) {
    resetAddProductForm();
    modal.style.display = 'block';
    document.body.classList.add('modal-open'); // Prevent background scrolling
    
    // Focus on the first input field
    setTimeout(() => {
      const skuInput = qs('#p_sku');
      if (skuInput) skuInput.focus();
    }, 300);
  }
}

function closeAddProductModal() {
  const modal = qs('#addProductModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    resetAddProductForm();
  }
}

function resetAddProductForm() {
  if (qs('#p_sku')) qs('#p_sku').value = '';
  if (qs('#p_name')) qs('#p_name').value = '';
  if (qs('#p_category')) qs('#p_category').value = '';
  if (qs('#p_quantity')) qs('#p_quantity').value = '0';
  if (qs('#p_unitCost')) qs('#p_unitCost').value = '0.00';
  if (qs('#p_unitPrice')) qs('#p_unitPrice').value = '0.00';
}

// =========================================
// NEW: Dashboard Statistics Loading
// =========================================
async function loadDashboardStats() {
  try {
    const response = await apiFetch(`${API_BASE}/dashboard/stats`);
    const data = await response.json();
    
    if (data.success) {
      // Update only 4 cards
      if (qs('#cardTotalProducts')) qs('#cardTotalProducts').textContent = data.stats.inventory.count;
      if (qs('#cardTotalStock')) qs('#cardTotalStock').textContent = data.stats.inventory.stock;
      if (qs('#cardTotalValue')) qs('#cardTotalValue').textContent = `RM ${data.stats.inventory.cost.toFixed(2)}`;
      if (qs('#cardTotalRevenue')) qs('#cardTotalRevenue').textContent = `RM ${data.stats.sales.total.toFixed(2)}`;
    }
  } catch (error) {
    console.error('Error loading dashboard stats:', error);
  }
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
    showToast('Please fill in all company information fields.', 'warning');
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/company`, {
      method: 'PUT',
      body: JSON.stringify({ name, address, phone, email })
    });

    if (res.ok) {
      showToast('Company information updated successfully!', 'success');
      await fetchCompanyInfo();
      closeCompanyInfoModal();
    } else {
      showToast('Failed to update company information.', 'error');
    }
  } catch (err) {
    console.error('Update company info error:', err);
    showToast('Server error while updating company information.', 'error');
  }
}

function updateCompanyInfoDisplay() {
  if (qs('#companyNameDisplay')) qs('#companyNameDisplay').textContent = companyInfo.name || 'L&B Company';
  if (qs('#companyAddressDisplay')) qs('#companyAddressDisplay').textContent = companyInfo.address || 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka';
  if (qs('#companyPhoneDisplay')) qs('#companyPhoneDisplay').textContent = companyInfo.phone || '01133127622';
  if (qs('#companyEmailDisplay')) qs('#companyEmailDisplay').textContent = companyInfo.email || 'lbcompany@gmail.com';
}

// =========================================
// Company Information Modal Functions
// =========================================
function openCompanyInfoModal() {
  const modal = qs('#companyInfoModal');
  if (modal) {
    // Pre-fill company form with current data
    if (qs('#companyName')) qs('#companyName').value = companyInfo.name || '';
    if (qs('#companyAddress')) qs('#companyAddress').value = companyInfo.address || '';
    if (qs('#companyPhone')) qs('#companyPhone').value = companyInfo.phone || '';
    if (qs('#companyEmail')) qs('#companyEmail').value = companyInfo.email || '';
    
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
  }
}

function closeCompanyInfoModal() {
  const modal = qs('#companyInfoModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
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
    // Load dashboard stats
    await loadDashboardStats();
  } catch (error) {
    console.error('Error fetching all data:', error);
  }
}

// =========================================
// INVENTORY PAGINATION FUNCTIONS
// =========================================
function updateInventoryPagination(items) {
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
  
  updateInventoryPageNumberButtons();
  updateInventoryPaginationButtonStates();
  
  return items.slice(start - 1, end);
}

function updateInventoryPageNumberButtons() {
  const pageNumbersContainer = qs('#pageNumbers');
  const pageNumbersFooter = qs('#pageNumbersFooter');
  
  if (!pageNumbersContainer && !pageNumbersFooter) return;
  
  const containers = [pageNumbersContainer, pageNumbersFooter].filter(Boolean);
  
  containers.forEach(container => {
    container.innerHTML = '';
    
    addInventoryPageButton(container, 1);
    
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
        addInventoryPageButton(container, i);
      }
    }
    
    if (currentPageNumber < totalPages - 2) {
      const ellipsis = document.createElement('span');
      ellipsis.textContent = '...';
      ellipsis.style.padding = '6px';
      container.appendChild(ellipsis);
    }
    
    if (totalPages > 1) {
      addInventoryPageButton(container, totalPages);
    }
  });
}

function addInventoryPageButton(container, pageNumber) {
  const button = document.createElement('button');
  button.className = `pagination-btn ${pageNumber === currentPageNumber ? 'active' : ''}`;
  button.textContent = pageNumber;
  button.onclick = () => goToInventoryPage(pageNumber);
  container.appendChild(button);
}

function updateInventoryPaginationButtonStates() {
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

function goToInventoryPage(page) {
  if (page < 1 || page > totalPages || page === currentPageNumber) return;
  currentPageNumber = page;
  renderInventory(filteredInventory);
}

function changeInventoryItemsPerPage() {
  const select = qs('#itemsPerPageSelect');
  if (select) {
    itemsPerPage = parseInt(select.value);
    currentPageNumber = 1;
    renderInventory(filteredInventory);
  }
}

function bindInventoryPaginationEvents() {
  qs('#firstPageBtn')?.addEventListener('click', () => goToInventoryPage(1));
  qs('#firstPageBtnFooter')?.addEventListener('click', () => goToInventoryPage(1));
  
  qs('#prevPageBtn')?.addEventListener('click', () => goToInventoryPage(currentPageNumber - 1));
  qs('#prevPageBtnFooter')?.addEventListener('click', () => goToInventoryPage(currentPageNumber - 1));
  
  qs('#nextPageBtn')?.addEventListener('click', () => goToInventoryPage(currentPageNumber + 1));
  qs('#nextPageBtnFooter')?.addEventListener('click', () => goToInventoryPage(currentPageNumber + 1));
  
  qs('#lastPageBtn')?.addEventListener('click', () => goToInventoryPage(totalPages));
  qs('#lastPageBtnFooter')?.addEventListener('click', () => goToInventoryPage(totalPages));
  
  qs('#itemsPerPageSelect')?.addEventListener('change', changeInventoryItemsPerPage);
}

// =========================================
// PURCHASE PAGINATION FUNCTIONS
// =========================================
function updatePurchasePagination(items) {
  const totalItems = items.length;
  purchaseTotalPages = Math.ceil(totalItems / purchaseItemsPerPage);
  
  if (currentPurchasePage > purchaseTotalPages) {
    currentPurchasePage = purchaseTotalPages || 1;
  }
  
  if (qs('#currentPurchasePage')) qs('#currentPurchasePage').textContent = currentPurchasePage;
  if (qs('#purchaseTotalPages')) qs('#purchaseTotalPages').textContent = purchaseTotalPages;
  if (qs('#purchaseTotalItems')) qs('#purchaseTotalItems').textContent = totalItems;
  
  const start = ((currentPurchasePage - 1) * purchaseItemsPerPage) + 1;
  const end = Math.min(currentPurchasePage * purchaseItemsPerPage, totalItems);
  
  if (qs('#currentPurchasePageStart')) qs('#currentPurchasePageStart').textContent = start;
  if (qs('#currentPurchasePageEnd')) qs('#currentPurchasePageEnd').textContent = end;
  
  updatePurchasePageNumberButtons();
  updatePurchasePaginationButtonStates();
  
  return items.slice(start - 1, end);
}

function updatePurchasePageNumberButtons() {
  const pageNumbersContainer = qs('#purchasePageNumbers');
  const pageNumbersFooter = qs('#purchasePageNumbersFooter');
  
  if (!pageNumbersContainer && !pageNumbersFooter) return;
  
  const containers = [pageNumbersContainer, pageNumbersFooter].filter(Boolean);
  
  containers.forEach(container => {
    container.innerHTML = '';
    
    addPurchasePageButton(container, 1);
    
    if (currentPurchasePage > 3) {
      const ellipsis = document.createElement('span');
      ellipsis.textContent = '...';
      ellipsis.style.padding = '6px';
      container.appendChild(ellipsis);
    }
    
    const startPage = Math.max(2, currentPurchasePage - 1);
    const endPage = Math.min(purchaseTotalPages - 1, currentPurchasePage + 1);
    
    for (let i = startPage; i <= endPage; i++) {
      if (i > 1 && i < purchaseTotalPages) {
        addPurchasePageButton(container, i);
      }
    }
    
    if (currentPurchasePage < purchaseTotalPages - 2) {
      const ellipsis = document.createElement('span');
      ellipsis.textContent = '...';
      ellipsis.style.padding = '6px';
      container.appendChild(ellipsis);
    }
    
    if (purchaseTotalPages > 1) {
      addPurchasePageButton(container, purchaseTotalPages);
    }
  });
}

function addPurchasePageButton(container, pageNumber) {
  const button = document.createElement('button');
  button.className = `pagination-btn ${pageNumber === currentPurchasePage ? 'active' : ''}`;
  button.textContent = pageNumber;
  button.onclick = () => goToPurchasePage(pageNumber);
  container.appendChild(button);
}

function updatePurchasePaginationButtonStates() {
  const buttons = {
    first: ['firstPurchasePageBtn', 'firstPurchasePageBtnFooter'],
    prev: ['prevPurchasePageBtn', 'prevPurchasePageBtnFooter'],
    next: ['nextPurchasePageBtn', 'nextPurchasePageBtnFooter'],
    last: ['lastPurchasePageBtn', 'lastPurchasePageBtnFooter']
  };
  
  Object.entries(buttons).forEach(([type, ids]) => {
    ids.forEach(id => {
      const btn = qs(`#${id}`);
      if (btn) {
        switch(type) {
          case 'first':
          case 'prev':
            btn.disabled = currentPurchasePage === 1;
            break;
          case 'next':
          case 'last':
            btn.disabled = currentPurchasePage === purchaseTotalPages;
            break;
        }
      }
    });
  });
}

function goToPurchasePage(page) {
  if (page < 1 || page > purchaseTotalPages || page === currentPurchasePage) return;
  currentPurchasePage = page;
  renderPurchaseHistory(filteredPurchases);
}

function changePurchaseItemsPerPage() {
  const select = qs('#purchaseItemsPerPageSelect');
  if (select) {
    purchaseItemsPerPage = parseInt(select.value);
    currentPurchasePage = 1;
    renderPurchaseHistory(filteredPurchases);
  }
}

function bindPurchasePaginationEvents() {
  qs('#firstPurchasePageBtn')?.addEventListener('click', () => goToPurchasePage(1));
  qs('#firstPurchasePageBtnFooter')?.addEventListener('click', () => goToPurchasePage(1));
  
  qs('#prevPurchasePageBtn')?.addEventListener('click', () => goToPurchasePage(currentPurchasePage - 1));
  qs('#prevPurchasePageBtnFooter')?.addEventListener('click', () => goToPurchasePage(currentPurchasePage - 1));
  
  qs('#nextPurchasePageBtn')?.addEventListener('click', () => goToPurchasePage(currentPurchasePage + 1));
  qs('#nextPurchasePageBtnFooter')?.addEventListener('click', () => goToPurchasePage(currentPurchasePage + 1));
  
  qs('#lastPurchasePageBtn')?.addEventListener('click', () => goToPurchasePage(purchaseTotalPages));
  qs('#lastPurchasePageBtnFooter')?.addEventListener('click', () => goToPurchasePage(purchaseTotalPages));
  
  qs('#purchaseItemsPerPageSelect')?.addEventListener('change', changePurchaseItemsPerPage);
}

// =========================================
// SALES PAGINATION FUNCTIONS
// =========================================
function updateSalesPagination(items) {
  const totalItems = items.length;
  salesTotalPages = Math.ceil(totalItems / salesItemsPerPage);
  
  if (currentSalesPage > salesTotalPages) {
    currentSalesPage = salesTotalPages || 1;
  }
  
  if (qs('#currentSalesPage')) qs('#currentSalesPage').textContent = currentSalesPage;
  if (qs('#salesTotalPages')) qs('#salesTotalPages').textContent = salesTotalPages;
  if (qs('#salesTotalItems')) qs('#salesTotalItems').textContent = totalItems;
  
  const start = ((currentSalesPage - 1) * salesItemsPerPage) + 1;
  const end = Math.min(currentSalesPage * salesItemsPerPage, totalItems);
  
  if (qs('#currentSalesPageStart')) qs('#currentSalesPageStart').textContent = start;
  if (qs('#currentSalesPageEnd')) qs('#currentSalesPageEnd').textContent = end;
  
  updateSalesPageNumberButtons();
  updateSalesPaginationButtonStates();
  
  return items.slice(start - 1, end);
}

function updateSalesPageNumberButtons() {
  const pageNumbersContainer = qs('#salesPageNumbers');
  const pageNumbersFooter = qs('#salesPageNumbersFooter');
  
  if (!pageNumbersContainer && !pageNumbersFooter) return;
  
  const containers = [pageNumbersContainer, pageNumbersFooter].filter(Boolean);
  
  containers.forEach(container => {
    container.innerHTML = '';
    
    addSalesPageButton(container, 1);
    
    if (currentSalesPage > 3) {
      const ellipsis = document.createElement('span');
      ellipsis.textContent = '...';
      ellipsis.style.padding = '6px';
      container.appendChild(ellipsis);
    }
    
    const startPage = Math.max(2, currentSalesPage - 1);
    const endPage = Math.min(salesTotalPages - 1, currentSalesPage + 1);
    
    for (let i = startPage; i <= endPage; i++) {
      if (i > 1 && i < salesTotalPages) {
        addSalesPageButton(container, i);
      }
    }
    
    if (currentSalesPage < salesTotalPages - 2) {
      const ellipsis = document.createElement('span');
      ellipsis.textContent = '...';
      ellipsis.style.padding = '6px';
      container.appendChild(ellipsis);
    }
    
    if (salesTotalPages > 1) {
      addSalesPageButton(container, salesTotalPages);
    }
  });
}

function addSalesPageButton(container, pageNumber) {
  const button = document.createElement('button');
  button.className = `pagination-btn ${pageNumber === currentSalesPage ? 'active' : ''}`;
  button.textContent = pageNumber;
  button.onclick = () => goToSalesPage(pageNumber);
  container.appendChild(button);
}

function updateSalesPaginationButtonStates() {
  const buttons = {
    first: ['firstSalesPageBtn', 'firstSalesPageBtnFooter'],
    prev: ['prevSalesPageBtn', 'prevSalesPageBtnFooter'],
    next: ['nextSalesPageBtn', 'nextSalesPageBtnFooter'],
    last: ['lastSalesPageBtn', 'lastSalesPageBtnFooter']
  };
  
  Object.entries(buttons).forEach(([type, ids]) => {
    ids.forEach(id => {
      const btn = qs(`#${id}`);
      if (btn) {
        switch(type) {
          case 'first':
          case 'prev':
            btn.disabled = currentSalesPage === 1;
            break;
          case 'next':
          case 'last':
            btn.disabled = currentSalesPage === salesTotalPages;
            break;
        }
      }
    });
  });
}

function goToSalesPage(page) {
  if (page < 1 || page > salesTotalPages || page === currentSalesPage) return;
  currentSalesPage = page;
  renderSalesHistory(filteredSales);
}

function changeSalesItemsPerPage() {
  const select = qs('#salesItemsPerPageSelect');
  if (select) {
    salesItemsPerPage = parseInt(select.value);
    currentSalesPage = 1;
    renderSalesHistory(filteredSales);
  }
}

function bindSalesPaginationEvents() {
  qs('#firstSalesPageBtn')?.addEventListener('click', () => goToSalesPage(1));
  qs('#firstSalesPageBtnFooter')?.addEventListener('click', () => goToSalesPage(1));
  
  qs('#prevSalesPageBtn')?.addEventListener('click', () => goToSalesPage(currentSalesPage - 1));
  qs('#prevSalesPageBtnFooter')?.addEventListener('click', () => goToSalesPage(currentSalesPage - 1));
  
  qs('#nextSalesPageBtn')?.addEventListener('click', () => goToSalesPage(currentSalesPage + 1));
  qs('#nextSalesPageBtnFooter')?.addEventListener('click', () => goToSalesPage(currentSalesPage + 1));
  
  qs('#lastSalesPageBtn')?.addEventListener('click', () => goToSalesPage(salesTotalPages));
  qs('#lastSalesPageBtnFooter')?.addEventListener('click', () => goToSalesPage(salesTotalPages));
  
  qs('#salesItemsPerPageSelect')?.addEventListener('change', changeSalesItemsPerPage);
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

function updateProfitCard() {
  let calculatedNetProfit = 0;
  
  // Calculate net profit from sales
  if (sales && sales.length > 0) {
    sales.forEach(sale => {
      if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(item => {
          const inventoryItem = inventory.find(i => i.sku === item.sku);
          if (inventoryItem) {
            const unitCost = inventoryItem.unitCost || 0;
            const salePrice = item.salePrice || 0;
            const quantity = item.quantity || 0;
            calculatedNetProfit += (salePrice - unitCost) * quantity;
          }
        });
      }
      // Also add direct net profit if available from API
      if (sale.totalNetProfit) {
        calculatedNetProfit += sale.totalNetProfit;
      }
    });
  }
  
  // Update total net profit
  totalNetProfit = calculatedNetProfit;
  
  // Update all net profit displays
  const netProfitElements = [
    '#cardTotalProfit',
    '#dash_totalProfit',
    '#totalNetProfitDisplay'
  ];
  
  netProfitElements.forEach(selector => {
    if (qs(selector)) {
      qs(selector).textContent = `RM ${totalNetProfit.toFixed(2)}`;
    }
  });
}

// UPDATED: Inventory table rendering without TOTAL COST and TOTAL PRICE columns
// UPDATED: Adjusted action buttons to be on the same horizontal line
function renderInventory(items) {
  const list = qs('#inventoryList');
  if(!list) return;
  
  const paginatedItems = updateInventoryPagination(items);
  
  list.innerHTML = '';
  let totalCost = 0, totalPrice = 0, totalStock = 0;

  // Calculate starting number for current page
  const startNumber = ((currentPageNumber - 1) * itemsPerPage) + 1;

  paginatedItems.forEach((it, index) => {
    const id = it.id || it._id;
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    
    totalStock += qty;

    // Date is already formatted as DD/MM/YYYY from server
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

    // FIXED: Removed TOTAL COST and TOTAL PRICE columns
    // UPDATED: Adjusted action buttons to be on the same horizontal line
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
    list.appendChild(tr);
  });

  // Update dashboard stats
  if(qs('#cardTotalStock')) qs('#cardTotalStock').textContent = totalStock;
  if(qs('#cardTotalProducts')) qs('#cardTotalProducts').textContent = items.length;
  
  // Load dashboard stats from API
  loadDashboardStats();
  
  // Attach event listeners for edit buttons
  attachInventoryEventListeners();
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
      
      // Convert DD/MM/YYYY to Date object for comparison
      const parseDate = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return null;
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      
      const itemDate = parseDate(item.createdAt);
      if (!itemDate) return false;
      
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
    
    // Convert DD/MM/YYYY to Date object for comparison
    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const parts = dateStr.split('/');
      if (parts.length !== 3) return null;
      return new Date(parts[2], parts[1] - 1, parts[0]);
    };
    
    const itemDate = parseDate(item.createdAt);
    if (!itemDate) return false;
    
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
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
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
      showToast('Start date cannot be after end date.', 'warning');
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
  
  // Validate required fields
  if(!sku || !name) {
    showToast('Please enter SKU and Product Name.', 'warning');
    return;
  }
  
  if (quantity < 0) {
    showToast('Quantity cannot be negative.', 'warning');
    return;
  }
  
  if (unitCost < 0) {
    showToast('Unit Cost cannot be negative.', 'warning');
    return;
  }
  
  if (unitPrice < 0) {
    showToast('Unit Price cannot be negative.', 'warning');
    return;
  }

  // Create a confirmation modal instead of alert
  const confirmed = await showConfirmation(
    'Add Product',
    `Confirm Add Product: ${name} (${sku})\nQuantity: ${quantity}\nUnit Cost: RM ${unitCost.toFixed(2)}\nUnit Price: RM ${unitPrice.toFixed(2)}`,
    'Add Product'
  );
  
  if(!confirmed) return;

  const newItem = { sku, name, category, quantity, unitCost, unitPrice };
  try {
    const res = await apiFetch(`${API_BASE}/inventory`, { method: 'POST', body: JSON.stringify(newItem) });
    if(res.ok) {
      // Close the modal first
      closeAddProductModal();
      
      // Then refresh data
      await fetchInventory();
      if(currentPage.includes('inventory')) await fetchLogs();
      showToast('Product added successfully.', 'success');
    } else {
      showToast('Failed to add product.', 'error');
    }
  } catch(e) { 
    console.error(e); 
    showToast('Server connection error while adding product.', 'error'); 
  }
}

async function confirmAndDeleteItem(id){
  const it = inventory.find(x => String(x.id) === String(id));
  if(!it) return;
  
  const confirmed = await showConfirmation(
    'Delete Product',
    `Confirm Delete: "${it.name}"?`,
    'Delete'
  );
  
  if(!confirmed) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method: 'DELETE' });
    if(res.status === 204) {
      await fetchInventory();
      showToast('Item deleted!', 'success');
    } else {
      showToast('Failed to delete item.', 'error');
    }
  } catch(e) { 
    console.error(e); 
    showToast('Server connection error while deleting product.', 'error'); 
  }
}

// =========================================
// Confirmation Modal System
// =========================================
function showConfirmation(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
  return new Promise((resolve) => {
    // Create modal if it doesn't exist
    let modal = qs('#confirmationModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'confirmationModal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content small-modal">
          <div class="modal-header">
            <h2 id="confirmationTitle"></h2>
            <span class="close" onclick="closeConfirmationModal()">&times;</span>
          </div>
          <div class="modal-body">
            <p id="confirmationMessage"></p>
          </div>
          <div class="modal-actions">
            <button class="secondary-btn" id="confirmationCancel">Cancel</button>
            <button class="primary-btn" id="confirmationConfirm">Confirm</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      
      // Add event listeners
      modal.querySelector('#confirmationCancel').addEventListener('click', () => {
        closeConfirmationModal();
        resolve(false);
      });
      
      modal.querySelector('#confirmationConfirm').addEventListener('click', () => {
        closeConfirmationModal();
        resolve(true);
      });
      
      modal.querySelector('.close').addEventListener('click', () => {
        closeConfirmationModal();
        resolve(false);
      });
    }
    
    // Set content
    qs('#confirmationTitle').textContent = title;
    qs('#confirmationMessage').textContent = message;
    qs('#confirmationConfirm').textContent = confirmText;
    qs('#confirmationCancel').textContent = cancelText;
    
    // Show modal
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
  });
}

function closeConfirmationModal() {
  const modal = qs('#confirmationModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
}

// =========================================
// FIXED: Edit Product Modal Functions - UPDATED: No Scroll
// =========================================
async function openEditProductModal(productId) {
  try {
    // First, try to get the product from the local inventory array
    let product = inventory.find(p => String(p.id) === String(productId));
    
    if (!product) {
      // If not found locally, fetch from API
      const response = await apiFetch(`${API_BASE}/inventory/${productId}`);
      product = await response.json();
    }
    
    if (!product) {
      throw new Error('Product not found');
    }
    
    // Check if edit modal exists
    const editModal = qs('#editProductModal');
    
    if (editModal) {
      // Use modal if it exists
      if (qs('#edit_product_id')) qs('#edit_product_id').value = product.id || product._id;
      if (qs('#edit_sku')) qs('#edit_sku').value = product.sku || '';
      if (qs('#edit_name')) qs('#edit_name').value = product.name || '';
      if (qs('#edit_category')) qs('#edit_category').value = product.category || '';
      if (qs('#edit_quantity')) qs('#edit_quantity').value = product.quantity || 0;
      if (qs('#edit_unitCost')) qs('#edit_unitCost').value = product.unitCost || 0;
      if (qs('#edit_unitPrice')) qs('#edit_unitPrice').value = product.unitPrice || 0;
      
      editModal.style.display = 'block';
      document.body.classList.add('modal-open');
    } else {
      // Fallback: Use simple prompt-based editing
      editProductSimple(productId, product);
    }
  } catch (error) {
    console.error('Error loading product for edit:', error);
    showToast('Error loading product details: ' + (error.message || 'Unknown error'), 'error');
  }
}

// Simple fallback edit function
async function editProductSimple(productId, product) {
  const confirmed = await showConfirmation(
    'Edit Product',
    'This will open simple edit fields. Continue?',
    'Continue',
    'Cancel'
  );
  
  if (!confirmed) return;
  
  const newName = prompt('Enter new product name:', product.name || '');
  if (newName === null) return; // User cancelled
  
  const newQuantity = prompt('Enter new quantity:', product.quantity || 0);
  if (newQuantity === null) return;
  
  const newUnitCost = prompt('Enter new unit cost:', product.unitCost || 0);
  if (newUnitCost === null) return;
  
  const newUnitPrice = prompt('Enter new unit price:', product.unitPrice || 0);
  if (newUnitPrice === null) return;
  
  const updatedProduct = {
    sku: product.sku,
    name: newName,
    category: product.category || '',
    quantity: parseInt(newQuantity) || 0,
    unitCost: parseFloat(newUnitCost) || 0,
    unitPrice: parseFloat(newUnitPrice) || 0
  };
  
  const updateConfirmed = await showConfirmation(
    'Update Product',
    `Update product?\n\nName: ${updatedProduct.name}\nQuantity: ${updatedProduct.quantity}\nUnit Cost: RM ${updatedProduct.unitCost.toFixed(2)}\nUnit Price: RM ${updatedProduct.unitPrice.toFixed(2)}`,
    'Update',
    'Cancel'
  );
  
  if (!updateConfirmed) return;
  
  try {
    const response = await apiFetch(`${API_BASE}/inventory/${productId}`, {
      method: 'PUT',
      body: JSON.stringify(updatedProduct)
    });
    
    if (response.ok) {
      await response.json();
      showToast('Product updated successfully!', 'success');
      await fetchInventory(); // Refresh the inventory list
      await loadDashboardStats(); // Refresh dashboard stats
    } else {
      const error = await response.json();
      showToast('Error updating product: ' + error.message, 'error');
    }
  } catch (error) {
    console.error('Error updating product:', error);
    showToast('Error updating product. Please try again.', 'error');
  }
}

async function updateProduct() {
  const productId = qs('#edit_product_id')?.value;
  
  if (!productId) {
    showToast('Error: No product ID found', 'error');
    return;
  }
  
  const updatedProduct = {
    sku: qs('#edit_sku')?.value || '',
    name: qs('#edit_name')?.value || '',
    category: qs('#edit_category')?.value || '',
    quantity: parseInt(qs('#edit_quantity')?.value || 0),
    unitCost: parseFloat(qs('#edit_unitCost')?.value || 0),
    unitPrice: parseFloat(qs('#edit_unitPrice')?.value || 0)
  };
  
  // Validate
  if (!updatedProduct.sku || !updatedProduct.name) {
    showToast('SKU and Name are required', 'warning');
    return;
  }
  
  if (updatedProduct.quantity < 0) {
    showToast('Quantity cannot be negative', 'warning');
    return;
  }
  
  if (updatedProduct.unitCost < 0 || updatedProduct.unitPrice < 0) {
    showToast('Cost and Price cannot be negative', 'warning');
    return;
  }
  
  const confirmed = await showConfirmation(
    'Update Product',
    `Update product: ${updatedProduct.name}?\nQuantity: ${updatedProduct.quantity}\nUnit Cost: RM ${updatedProduct.unitCost.toFixed(2)}\nUnit Price: RM ${updatedProduct.unitPrice.toFixed(2)}`,
    'Update',
    'Cancel'
  );
  
  if (!confirmed) return;
  
  try {
    const response = await apiFetch(`${API_BASE}/inventory/${productId}`, {
      method: 'PUT',
      body: JSON.stringify(updatedProduct)
    });
    
    if (response.ok) {
      await response.json();
      showToast('Product updated successfully!', 'success');
      closeEditProductModal();
      await fetchInventory(); // Refresh the inventory list
      await loadDashboardStats(); // Refresh dashboard stats
    } else {
      const error = await response.json();
      showToast('Error updating product: ' + error.message, 'error');
    }
  } catch (error) {
    console.error('Error updating product:', error);
    showToast('Error updating product. Please try again.', 'error');
  }
}

function closeEditProductModal() {
  const modal = qs('#editProductModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
}

// =========================================
// Attach Inventory Event Listeners
// =========================================
function attachInventoryEventListeners() {
  // Edit button event listener
  qsa('.edit-btn').forEach(btn => {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      const productId = this.getAttribute('data-id');
      await openEditProductModal(productId);
    });
  });
}

// =========================================
// PRODUCT EDIT PAGE FUNCTIONS (Legacy)
// =========================================
async function bindProductPage(){
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if(id) {
    try {
      const res = await apiFetch(`${API_BASE}/inventory`);
      const items = await res.json();
      const it = items.find(x => String(x.id) === String(id));
      if(!it) { 
        showToast('Item not found', 'error'); 
        return; 
      }
      if(qs('#prod_id')) qs('#prod_id').value = it.id || it._id;
      if(qs('#prod_sku')) qs('#prod_sku').value = it.sku || '';
      if(qs('#prod_name')) qs('#prod_name').value = it.name || '';
      if(qs('#prod_category')) qs('#prod_category').value = it.category || '';
      if(qs('#prod_quantity')) qs('#prod_quantity').value = it.quantity || 0;
      if(qs('#prod_unitCost')) qs('#prod_unitCost').value = it.unitCost || 0;
      if(qs('#prod_unitPrice')) qs('#prod_unitPrice').value = it.unitPrice || 0;
    } catch(e) { 
      showToast('Failed to load product details.', 'error'); 
      return; 
    }
  }

  qs('#saveProductBtn')?.addEventListener('click', async ()=> {
    const confirmed = await showConfirmation('Save Changes', 'Confirm: Save Changes?', 'Save', 'Cancel');
    if(!confirmed) return;
    
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
      if(res.ok) { 
        showToast('Item updated', 'success'); 
        window.location.href = 'inventory.html'; 
      }
      else { 
        const err = await res.json(); 
        showToast('Failed to update item: ' + (err.message || 'Unknown'), 'error'); 
      }
    } catch(e) { 
      console.error(e); 
      showToast('Server connection error during update.', 'error'); 
    }
  });

  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href = 'inventory.html');
}

// =========================================
// Sales Management Functions - UPDATED WITH PAYMENT LOGIC
// =========================================
async function fetchSales() {
  try {
    const res = await apiFetch(`${API_BASE}/sales`);
    if (!res.ok) throw new Error('Failed to fetch sales');
    const data = await res.json();
    sales = data.map(s => ({ ...s, id: s.id || s._id }));
    filteredSales = [...sales];
  } catch(err) {
    console.error('Fetch sales error:', err);
  }
}

// UPDATED: Sales history table with payment method column and adjusted action buttons
function renderSalesHistory(items) {
  const list = qs('#salesHistoryList');
  if (!list) return;
  list.innerHTML = '';
  
  const paginatedItems = updateSalesPagination(items);
  const startNumber = ((currentSalesPage - 1) * salesItemsPerPage) + 1;
  
  paginatedItems.forEach((s, index) => {
    // Get payment method display text
    let paymentMethodDisplay = 'N/A';
    if (s.paymentMethod) {
      switch(s.paymentMethod) {
        case 'cash': paymentMethodDisplay = '💵 Cash'; break;
        case 'online': paymentMethodDisplay = '📱 Online/QR'; break;
        case 'card': paymentMethodDisplay = '💳 Card'; break;
        default: paymentMethodDisplay = s.paymentMethod;
      }
    }
    
    // Get payment status based on amount received
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
    list.appendChild(tr);
  });
}

function openSalesHistoryModal() {
  const modal = qs('#salesHistoryModal');
  if (modal) {
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
    // Reset pagination when opening modal
    currentSalesPage = 1;
    renderSalesHistory(filteredSales);
  }
}

function closeSalesHistoryModal() {
  const modal = qs('#salesHistoryModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
}

// Sales Search Function
function searchSales() {
  const textQuery = (qs('#salesSearchInput')?.value || '').toLowerCase().trim();
  const startDate = qs('#salesStartDate')?.value || '';
  const endDate = qs('#salesEndDate')?.value || '';
  
  let filtered = sales;
  
  if (textQuery) {
    filtered = filtered.filter(sale => 
      (sale.salesId||'').toLowerCase().includes(textQuery) || 
      (sale.customer||'').toLowerCase().includes(textQuery) ||
      (sale.customerContact||'').toLowerCase().includes(textQuery) ||
      (sale.notes||'').toLowerCase().includes(textQuery) ||
      (sale.paymentMethod||'').toLowerCase().includes(textQuery)
    );
  }
  
  if (startDate || endDate) {
    filtered = filtered.filter(sale => {
      if (!sale.salesDate) return false;
      
      const parseDate = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return null;
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      
      const saleDate = parseDate(sale.salesDate);
      if (!saleDate) return false;
      
      if (startDate && !endDate) {
        const start = new Date(startDate);
        return saleDate >= start;
      }
      
      if (!startDate && endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return saleDate <= end;
      }
      
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return saleDate >= start && saleDate <= end;
      }
      
      return true;
    });
  }
  
  filteredSales = filtered;
  currentSalesPage = 1;
  renderSalesHistory(filtered);
}

function clearSalesSearch() {
  if (qs('#salesSearchInput')) qs('#salesSearchInput').value = '';
  if (qs('#salesStartDate')) qs('#salesStartDate').value = '';
  if (qs('#salesEndDate')) qs('#salesEndDate').value = '';
  filteredSales = [...sales];
  currentSalesPage = 1;
  renderSalesHistory(filteredSales);
}

function applySalesDateRangeFilter() {
  const startDate = qs('#salesStartDate')?.value;
  const endDate = qs('#salesEndDate')?.value;
  
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start > end) {
      showToast('Start date cannot be after end date.', 'warning');
      return;
    }
  }
  
  searchSales();
}

function bindSalesSearchEvents() {
  qs('#salesSearchInput')?.addEventListener('input', searchSales);
  qs('#clearSalesSearchBtn')?.addEventListener('click', clearSalesSearch);
  qs('#applySalesDateRangeBtn')?.addEventListener('click', applySalesDateRangeFilter);
  qs('#clearSalesDateRangeBtn')?.addEventListener('click', clearSalesSearch);
  
  qs('#salesStartDate')?.addEventListener('change', function() {
    if (qs('#salesEndDate')?.value) {
      applySalesDateRangeFilter();
    }
  });
  
  qs('#salesEndDate')?.addEventListener('change', function() {
    if (qs('#salesStartDate')?.value) {
      applySalesDateRangeFilter();
    }
  });
}

// UPDATED: New Sales Modal - No Scroll WITH PAYMENT LOGIC
function openNewSalesModal() {
  const modal = qs('#newSalesModal');
  if (modal) {
    resetSalesForm();
    const salesItems = qs('#salesItems');
    if (salesItems) salesItems.innerHTML = '';
    loadProductSearchForSales();
    
    // Set default date to today
    if (qs('#salesDate')) {
      const today = new Date().toISOString().split('T')[0];
      qs('#salesDate').value = today;
    }
    
    // Initialize payment method visibility
    updatePaymentFieldsVisibility();
    
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
    
    // Set initial total amount
    updateSalesTotalAmount();
  } else {
    console.error('New sales modal not found');
    showToast('Sales modal not found. Please check if the HTML is loaded correctly.', 'error');
  }
}

function closeNewSalesModal() {
  const modal = qs('#newSalesModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
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
  if (qs('#grandTotalAmount')) qs('#grandTotalAmount').textContent = '0.00';
  if (qs('#paymentMethod')) qs('#paymentMethod').value = 'cash';
  if (qs('#amountReceived')) qs('#amountReceived').value = '';
  if (qs('#changeAmount')) qs('#changeAmount').textContent = '0.00';
  if (qs('#changeMessage')) qs('#changeMessage').style.display = 'none';
  if (qs('#paymentValidationMessage')) qs('#paymentValidationMessage').style.display = 'none';
  
  // Reset save button
  const saveBtn = qs('#saveSalesBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add('disabled');
  }
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
  
  // Update both total displays
  if (qs('#totalSalesAmount')) {
    qs('#totalSalesAmount').textContent = total.toFixed(2);
  }
  
  if (qs('#grandTotalAmount')) {
    qs('#grandTotalAmount').textContent = total.toFixed(2);
  }
  
  // Update payment validation
  calculateChange();
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

// UPDATED: Save Sales Order with Payment Data
async function saveSalesOrder() {
  const customerName = qs('#customerName')?.value?.trim();
  const customerContact = qs('#customerContact')?.value?.trim();
  
  if (!customerName || !customerContact) {
    showToast('Please enter customer name and contact information.', 'warning');
    return;
  }
  
  const salesDate = qs('#salesDate').value;
  const notes = qs('#salesNotes').value.trim();
  const paymentMethod = qs('#paymentMethod').value;
  const amountReceived = parseFloat(qs('#amountReceived').value) || 0;
  const changeAmount = parseFloat(qs('#changeAmount').textContent) || 0;
  
  const items = [];
  const itemRows = qsa('.sales-item-row');
  
  if (itemRows.length === 0) {
    showToast('Please add at least one product item.', 'warning');
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
      showToast('Please fill in all fields for each product item.', 'warning');
      return;
    }
    
    if (quantity <= 0) {
      showToast('Please enter a valid quantity greater than 0.', 'warning');
      return;
    }
    
    if (salePrice <= 0) {
      showToast('Please enter a valid sale price greater than 0.', 'warning');
      return;
    }
    
    const inventoryItem = inventory.find(item => item.sku === sku);
    if (inventoryItem && inventoryItem.quantity < quantity) {
      showToast(`Insufficient stock for ${productName}. Available: ${inventoryItem.quantity}, Requested: ${quantity}`, 'error');
      return;
    }
    
    items.push({
      sku,
      productName,
      quantity,
      salePrice
    });
  }
  
  const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.salePrice), 0);
  
  const salesData = {
    customer: customerName,
    customerContact: customerContact,
    salesDate: salesDate || new Date().toISOString().split('T')[0],
    notes,
    paymentMethod,
    amountReceived: paymentMethod === 'cash' ? amountReceived : totalAmount,
    changeAmount: paymentMethod === 'cash' ? changeAmount : 0,
    items
  };
  
  let confirmMessage = `Confirm Sales Order:\n\nCustomer: ${customerName}\nContact: ${customerContact}\nPayment Method: ${paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'online' ? 'Online Transfer/QR' : 'Credit/Debit Card'}\n\nItems:\n`;
  items.forEach((item, index) => {
    confirmMessage += `${index + 1}. ${item.productName} (${item.sku}) - ${item.quantity} x RM ${item.salePrice.toFixed(2)} = RM ${(item.quantity * item.salePrice).toFixed(2)}\n`;
  });
  
  if (paymentMethod === 'cash') {
    confirmMessage += `\nAmount Received: RM ${amountReceived.toFixed(2)}\nChange: RM ${changeAmount.toFixed(2)}`;
  }
  
  confirmMessage += `\n\nTotal Amount: RM ${totalAmount.toFixed(2)}`;
  
  const confirmed = await showConfirmation('Sales Order Confirmation', confirmMessage, 'Confirm Order', 'Cancel');
  
  if (!confirmed) {
    return;
  }
  
  try {
    const res = await apiFetch(`${API_BASE}/sales`, {
      method: 'POST',
      body: JSON.stringify(salesData)
    });
    
    if (res.ok) {
      const savedSales = await res.json();
      showToast('Sales order saved successfully!', 'success');
      
      // Refresh data
      await fetchInventory();
      await fetchSales();
      
      // Automatically print and save invoice
      await printAndSaveSalesInvoice(savedSales.id);
      
      closeNewSalesModal();
      
    } else {
      const error = await res.json();
      showToast(`Failed to save sales order: ${error.message}`, 'error');
    }
  } catch (e) {
    console.error('Save sales order error:', e);
    showToast('Server connection error while saving sales order.', 'error');
  }
}

async function viewSalesDetails(salesId) {
  try {
    const res = await apiFetch(`${API_BASE}/sales/${salesId}`);
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || 'Failed to fetch sales details');
    }
    
    const sale = await res.json();
    
    if (!qs('#salesDetailsModal')) {
      console.error('Sales details modal not found');
      showToast('Sales details modal is not available. Please refresh the page.', 'error');
      return;
    }
    
    // Update payment method display
    let paymentMethodDisplay = 'N/A';
    if (sale.paymentMethod) {
      switch(sale.paymentMethod) {
        case 'cash': paymentMethodDisplay = '💵 Cash'; break;
        case 'online': paymentMethodDisplay = '📱 Online Transfer/QR'; break;
        case 'card': paymentMethodDisplay = '💳 Credit/Debit Card'; break;
        default: paymentMethodDisplay = sale.paymentMethod;
      }
    }
    
    const detailElements = {
      'detailSalesId': 'detailSalesId',
      'detailCustomer': 'detailCustomer',
      'detailCustomerContact': 'detailCustomerContact',
      'detailSalesDate': 'detailSalesDate',
      'detailSalesTotalAmount': 'detailSalesTotalAmount',
      'detailSalesNotes': 'detailSalesNotes',
      'detailSalesNotesRow': 'detailSalesNotesRow',
      'detailPaymentMethod': 'detailPaymentMethod',
      'detailAmountReceived': 'detailAmountReceived',
      'detailChangeAmount': 'detailChangeAmount',
      'detailPaymentRow': 'detailPaymentRow'
    };
    
    Object.entries(detailElements).forEach(([key, elementId]) => {
      const element = qs(`#${elementId}`);
      if (element) {
        switch(key) {
          case 'detailSalesId':
            element.textContent = sale.salesId || 'N/A';
            break;
          case 'detailCustomer':
            element.textContent = sale.customer || 'N/A';
            break;
          case 'detailCustomerContact':
            element.textContent = sale.customerContact || 'N/A';
            break;
          case 'detailSalesDate':
            element.textContent = sale.salesDate || 'N/A';
            break;
          case 'detailSalesTotalAmount':
            element.textContent = `RM ${(sale.totalAmount || 0).toFixed(2)}`;
            break;
          case 'detailSalesNotes':
            if (sale.notes && sale.notes.trim()) {
              element.textContent = sale.notes;
              const notesRow = qs('#detailSalesNotesRow');
              if (notesRow) notesRow.style.display = 'flex';
            } else {
              const notesRow = qs('#detailNotesRow');
              if (notesRow) notesRow.style.display = 'none';
            }
            break;
          case 'detailPaymentMethod':
            element.textContent = paymentMethodDisplay;
            break;
          case 'detailAmountReceived':
            element.textContent = `RM ${(sale.amountReceived || 0).toFixed(2)}`;
            break;
          case 'detailChangeAmount':
            element.textContent = `RM ${(sale.changeAmount || 0).toFixed(2)}`;
            break;
          case 'detailPaymentRow':
            if (sale.paymentMethod) {
              element.style.display = 'flex';
            } else {
              element.style.display = 'none';
            }
            break;
        }
      }
    });
    
    const itemsList = qs('#salesDetailsList');
    if (itemsList) {
      itemsList.innerHTML = '';
      
      if (sale.items && Array.isArray(sale.items)) {
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
      }
    }
    
    const printBtn = qs('#printSalesInvoiceBtn');
    if (printBtn) {
      printBtn.onclick = () => printAndSaveSalesInvoice(salesId);
    }
    
    const modal = qs('#salesDetailsModal');
    if (modal) {
      modal.style.display = 'block';
      document.body.classList.add('modal-open');
    }
    
  } catch (e) {
    console.error('View sales details error:', e);
    showToast(`Failed to load sales details: ${e.message}`, 'error');
  }
}

function closeSalesDetailsModal() {
  const modal = qs('#salesDetailsModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
}

// FIXED: Sales Delete Function - Immediate refresh without page reload
async function deleteSales(id) {
  const sale = sales.find(s => String(s.id) === String(id));
  if (!sale) return;
  
  const confirmed = await showConfirmation(
    'Delete Sales Order',
    `Confirm Delete Sales Order:\n${sale.salesId} for ${sale.customer}?\n\nThis will remove ${sale.items.length} items and revert inventory quantities.`,
    'Delete',
    'Cancel'
  );
  
  if (!confirmed) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/sales/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const result = await res.json();
      if (result.success) {
        // Remove from local arrays
        sales = sales.filter(s => String(s.id) !== String(id));
        filteredSales = filteredSales.filter(s => String(s.id) !== String(id));
        
        // Update UI immediately
        renderSalesHistory(filteredSales);
        
        // Refresh inventory data in background
        fetchInventory().catch(console.error);
        
        showToast('Sales order deleted successfully!', 'success');
      } else {
        showToast('Failed to delete sales order: ' + (result.message || 'Unknown error'), 'error');
      }
    } else {
      const error = await res.json();
      showToast('Failed to delete sales order: ' + (error.message || 'Unknown error'), 'error');
    }
  } catch (e) {
    console.error('Sales delete error:', e);
    showToast('Server connection error while deleting sales order.', 'error');
  }
}

async function printAndSaveSalesInvoice(salesId) {
  try {
    const sale = sales.find(s => String(s.id) === String(salesId));
    if (!sale) {
      showToast('Sales order not found.', 'error');
      return;
    }
    
    const res = await fetch(`${API_BASE}/sales/invoice/${salesId}`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: 'Failed to generate invoice' }));
      throw new Error(error.message || 'Failed to generate invoice');
    }
    
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    
    const filename = sale.salesId ? `Invoice_${sale.salesId}.pdf` : `Invoice_${salesId}.pdf`;
    
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    
    // Try to save invoice to documents
    try {
      const saveRes = await apiFetch(`${API_BASE}/sales/save-invoice/${salesId}`, {
        method: 'POST'
      });
      
      if (saveRes.ok) {
        console.log('✅ Invoice saved to documents');
        showToast('Invoice saved to documents', 'success');
      }
    } catch (saveError) {
      console.error('Invoice save to documents error:', saveError);
      // Don't show toast for this error as the download was successful
    }
    
  } catch (e) {
    console.error('Print and save invoice error:', e);
    showToast('Failed to generate sales invoice: ' + e.message, 'error');
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
    filteredPurchases = [...purchases];
  } catch(err) {
    console.error('Fetch purchases error:', err);
  }
}

function renderPurchaseHistory(items) {
  const list = qs('#purchaseHistoryList');
  if (!list) return;
  list.innerHTML = '';
  
  const paginatedItems = updatePurchasePagination(items);
  const startNumber = ((currentPurchasePage - 1) * purchaseItemsPerPage) + 1;
  
  paginatedItems.forEach((p, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="number-cell">${startNumber + index}</td>
      <td>${escapeHtml(p.purchaseId || 'N/A')}</td>
      <td>${escapeHtml(p.supplier || '')}</td>
      <td>${escapeHtml(p.supplierContact || 'N/A')}</td>
      <td>${p.items ? p.items.length : 0} items</td>
      <td class="money">RM ${(p.totalAmount || 0).toFixed(2)}</td>
      <td>${escapeHtml(p.purchaseDate || 'N/A')}</td>
      <td class="actions">
        <div class="action-buttons-horizontal">
          <button class="primary-btn small-btn" onclick="viewPurchaseDetails('${p.id}')">👁️ View</button>
          <button class="success-btn small-btn" onclick="printAndSavePurchaseInvoice('${p.id}')">🖨️ Invoice</button>
          <button class="danger-btn small-btn" onclick="deletePurchase('${p.id}')">🗑️ Delete</button>
        </div>
      </td>
    `;
    list.appendChild(tr);
  });
}

function openPurchaseHistoryModal() {
  const modal = qs('#purchaseHistoryModal');
  if (modal) {
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
    currentPurchasePage = 1;
    renderPurchaseHistory(filteredPurchases);
  }
}

function closePurchaseHistoryModal() {
  const modal = qs('#purchaseHistoryModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
}

function searchPurchases() {
  const textQuery = (qs('#purchaseSearchInput')?.value || '').toLowerCase().trim();
  const startDate = qs('#purchaseStartDate')?.value || '';
  const endDate = qs('#purchaseEndDate')?.value || '';
  
  let filtered = purchases;
  
  if (textQuery) {
    filtered = filtered.filter(purchase => 
      (purchase.purchaseId||'').toLowerCase().includes(textQuery) || 
      (purchase.supplier||'').toLowerCase().includes(textQuery) ||
      (purchase.supplierContact||'').toLowerCase().includes(textQuery) ||
      (purchase.notes||'').toLowerCase().includes(textQuery)
    );
  }
  
  if (startDate || endDate) {
    filtered = filtered.filter(purchase => {
      if (!purchase.purchaseDate) return false;
      
      const parseDate = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return null;
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      
      const purchaseDate = parseDate(purchase.purchaseDate);
      if (!purchaseDate) return false;
      
      if (startDate && !endDate) {
        const start = new Date(startDate);
        return purchaseDate >= start;
      }
      
      if (!startDate && endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return purchaseDate <= end;
      }
      
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return purchaseDate >= start && purchaseDate <= end;
      }
      
      return true;
    });
  }
  
  filteredPurchases = filtered;
  currentPurchasePage = 1;
  renderPurchaseHistory(filtered);
}

function clearPurchaseSearch() {
  if (qs('#purchaseSearchInput')) qs('#purchaseSearchInput').value = '';
  if (qs('#purchaseStartDate')) qs('#purchaseStartDate').value = '';
  if (qs('#purchaseEndDate')) qs('#purchaseEndDate').value = '';
  filteredPurchases = [...purchases];
  currentPurchasePage = 1;
  renderPurchaseHistory(filteredPurchases);
}

function applyPurchaseDateRangeFilter() {
  const startDate = qs('#purchaseStartDate')?.value;
  const endDate = qs('#purchaseEndDate')?.value;
  
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start > end) {
      showToast('Start date cannot be after end date.', 'warning');
      return;
    }
  }
  
  searchPurchases();
}

function bindPurchaseSearchEvents() {
  qs('#purchaseSearchInput')?.addEventListener('input', searchPurchases);
  qs('#clearPurchaseSearchBtn')?.addEventListener('click', clearPurchaseSearch);
  qs('#applyPurchaseDateRangeBtn')?.addEventListener('click', applyPurchaseDateRangeFilter);
  qs('#clearPurchaseDateRangeBtn')?.addEventListener('click', clearPurchaseSearch);
  
  qs('#purchaseStartDate')?.addEventListener('change', function() {
    if (qs('#purchaseEndDate')?.value) {
      applyPurchaseDateRangeFilter();
    }
  });
  
  qs('#purchaseEndDate')?.addEventListener('change', function() {
    if (qs('#purchaseStartDate')?.value) {
      applyPurchaseDateRangeFilter();
    }
  });
}

function openNewPurchaseModal() {
  const modal = qs('#newPurchaseModal');
  if (modal) {
    resetPurchaseForm();
    const purchaseItems = qs('#purchaseItems');
    if (purchaseItems) purchaseItems.innerHTML = '';
    loadProductSearch();
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
    updateTotalAmount();
  } else {
    console.error('New purchase modal not found');
    showToast('Purchase modal not found. Please check if the HTML is loaded correctly.', 'error');
  }
}

function closeNewPurchaseModal() {
  const modal = qs('#newPurchaseModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
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
  const supplierName = qs('#supplierName')?.value?.trim();
  const supplierContact = qs('#supplierContact')?.value?.trim();
  
  if (!supplierName || !supplierContact) {
    showToast('Please enter supplier name and contact information.', 'warning');
    return;
  }
  
  const purchaseDate = qs('#purchaseDate').value;
  const notes = qs('#purchaseNotes').value.trim();
  
  const items = [];
  const itemRows = qsa('.purchase-item-row');
  
  if (itemRows.length === 0) {
    showToast('Please add at least one product item.', 'warning');
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
      showToast('Please fill in all fields for each product item.', 'warning');
      return;
    }
    
    if (quantity <= 0) {
      showToast('Please enter a valid quantity greater than 0.', 'warning');
      return;
    }
    
    if (purchasePrice <= 0) {
      showToast('Please enter a valid purchase price greater than 0.', 'warning');
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
    supplier: supplierName,
    supplierContact: supplierContact,
    purchaseDate: purchaseDate || new Date().toISOString().split('T')[0],
    notes,
    items
  };
  
  let confirmMessage = `Confirm Restock Order:\n\nSupplier: ${supplierName}\nContact: ${supplierContact}\nItems: ${items.length}\n\nItems:\n`;
  items.forEach((item, index) => {
    confirmMessage += `${index + 1}. ${item.productName} (${item.sku}) - ${item.quantity} x RM ${item.purchasePrice.toFixed(2)} = RM ${(item.quantity * item.purchasePrice).toFixed(2)}\n`;
  });
  confirmMessage += `\nTotal Amount: RM ${purchaseData.items.reduce((sum, item) => sum + (item.quantity * item.purchasePrice), 0).toFixed(2)}`;
  
  const confirmed = await showConfirmation('Restock Order Confirmation', confirmMessage, 'Confirm Order', 'Cancel');
  
  if (!confirmed) {
    return;
  }
  
  try {
    const res = await apiFetch(`${API_BASE}/purchases`, {
      method: 'POST',
      body: JSON.stringify(purchaseData)
    });
    
    if (res.ok) {
      const savedPurchase = await res.json();
      showToast('Restock order saved successfully!', 'success');
      
      await fetchInventory();
      await fetchPurchases();
      
      await printAndSavePurchaseInvoice(savedPurchase.id);
      
      closeNewPurchaseModal();
      
    } else {
      const error = await res.json();
      showToast(`Failed to save restock order: ${error.message}`, 'error');
    }
  } catch (e) {
    console.error('Save purchase order error:', e);
    showToast('Server connection error while saving restock order.', 'error');
  }
}

async function viewPurchaseDetails(purchaseId) {
  try {
    const res = await apiFetch(`${API_BASE}/purchases/${purchaseId}`);
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || 'Failed to fetch purchase details');
    }
    
    const purchase = await res.json();
    
    if (!qs('#purchaseDetailsModal')) {
      console.error('Purchase details modal not found');
      showToast('Purchase details modal is not available. Please refresh the page.', 'error');
      return;
    }
    
    const detailElements = {
      'detailPurchaseId': 'detailPurchaseId',
      'detailSupplier': 'detailSupplier',
      'detailSupplierContact': 'detailSupplierContact',
      'detailPurchaseDate': 'detailPurchaseDate',
      'detailTotalAmount': 'detailTotalAmount',
      'detailNotes': 'detailNotes',
      'detailNotesRow': 'detailNotesRow'
    };
    
    Object.entries(detailElements).forEach(([key, elementId]) => {
      const element = qs(`#${elementId}`);
      if (element) {
        switch(key) {
          case 'detailPurchaseId':
            element.textContent = purchase.purchaseId || 'N/A';
            break;
          case 'detailSupplier':
            element.textContent = purchase.supplier || 'N/A';
            break;
          case 'detailSupplierContact':
            element.textContent = purchase.supplierContact || 'N/A';
            break;
          case 'detailPurchaseDate':
            element.textContent = purchase.purchaseDate || 'N/A';
            break;
          case 'detailTotalAmount':
            element.textContent = `RM ${(purchase.totalAmount || 0).toFixed(2)}`;
            break;
          case 'detailNotes':
            if (purchase.notes && purchase.notes.trim()) {
              element.textContent = purchase.notes;
              const notesRow = qs('#detailNotesRow');
              if (notesRow) notesRow.style.display = 'flex';
            } else {
              const notesRow = qs('#detailNotesRow');
              if (notesRow) notesRow.style.display = 'none';
            }
            break;
        }
      }
    });
    
    const itemsList = qs('#purchaseDetailsList');
    if (itemsList) {
      itemsList.innerHTML = '';
      
      if (purchase.items && Array.isArray(purchase.items)) {
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
      }
    }
    
    const printBtn = qs('#printDetailsInvoiceBtn');
    if (printBtn) {
      printBtn.onclick = () => printAndSavePurchaseInvoice(purchaseId);
    }
    
    const modal = qs('#purchaseDetailsModal');
    if (modal) {
      modal.style.display = 'block';
      document.body.classList.add('modal-open');
    }
    
  } catch (e) {
    console.error('View purchase details error:', e);
    showToast(`Failed to load purchase details: ${e.message}`, 'error');
  }
}

function closePurchaseDetailsModal() {
  const modal = qs('#purchaseDetailsModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
}

// FIXED: Purchase Delete Function - Immediate refresh
async function deletePurchase(id) {
  const purchase = purchases.find(p => String(p.id) === String(id));
  if (!purchase) return;
  
  const confirmed = await showConfirmation(
    'Delete Restock Order',
    `Confirm Delete Restock Order:\n${purchase.purchaseId} from ${purchase.supplier}?\n\nThis will remove ${purchase.items.length} items and revert inventory quantities.`,
    'Delete',
    'Cancel'
  );
  
  if (!confirmed) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/purchases/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const result = await res.json();
      if (result.success) {
        // Remove from local arrays
        purchases = purchases.filter(p => String(p.id) !== String(id));
        filteredPurchases = filteredPurchases.filter(p => String(p.id) !== String(id));
        
        // Update UI immediately
        renderPurchaseHistory(filteredPurchases);
        
        // Refresh inventory data in background
        fetchInventory().catch(console.error);
        
        showToast('Restock order deleted successfully!', 'success');
      } else {
        showToast('Failed to delete restock order: ' + (result.message || 'Unknown error'), 'error');
      }
    } else {
      const error = await res.json();
      showToast('Failed to delete restock order: ' + (error.message || 'Unknown error'), 'error');
    }
  } catch (e) {
    console.error('Purchase delete error:', e);
    showToast('Server connection error while deleting restock order.', 'error');
  }
}

async function printAndSavePurchaseInvoice(purchaseId) {
  try {
    const purchase = purchases.find(p => String(p.id) === String(purchaseId));
    if (!purchase) {
      showToast('Purchase order not found.', 'error');
      return;
    }
    
    const res = await fetch(`${API_BASE}/purchases/invoice/${purchaseId}`);
    if (!res.ok) throw new Error('Failed to generate invoice');
    
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    
    const filename = purchase.purchaseId ? `Invoice_${purchase.purchaseId}.pdf` : `Invoice_${purchaseId}.pdf`;
    
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    
    // Try to save invoice to documents
    try {
      const saveRes = await apiFetch(`${API_BASE}/purchases/save-invoice/${purchaseId}`, {
        method: 'POST'
      });
      
      if (saveRes.ok) {
        console.log('✅ Purchase invoice saved to documents');
        showToast('Purchase invoice saved to documents', 'success');
      }
    } catch (saveError) {
      console.error('Invoice save to documents error:', saveError);
      // Don't show toast for this error as the download was successful
    }
    
  } catch (e) {
    console.error('Print and save invoice error:', e);
    showToast('Failed to generate invoice: ' + e.message, 'error');
  }
}

// =========================================
// Enhanced Report Generation with Date Range
// =========================================
function openReportModal() {
  const modal = qs('#reportModal');
  if (modal) {
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
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
    document.body.classList.remove('modal-open');
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
    showToast('Please select a report type.', 'warning');
    return;
  }
  
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    showToast('Start date cannot be after end date.', 'warning');
    return;
  }
  
  closeReportModal();
  
  switch (reportType) {
    case 'inventory':
      await generateInventoryReport(startDate, endDate);
      break;
    case 'sales':
      await generateSalesReport(startDate, endDate);
      break;
  }
}

async function generateInventoryReport(startDate, endDate) {
  const confirmed = await showConfirmation('Generate Report', 'Generate Inventory Report?', 'Generate', 'Cancel');
  if (!confirmed) return;
  
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
    
    showToast('Inventory Report Generated Successfully!', 'success');
    
  } catch (e) {
    console.error('Inventory report error:', e);
    showToast('Failed to generate inventory report.', 'error');
  }
}

// NEW: Sales Report Generation
async function generateSalesReport(startDate, endDate) {
  const confirmed = await showConfirmation('Generate Report', 'Generate Sales Report?', 'Generate', 'Cancel');
  if (!confirmed) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/sales/report/pdf`, {
      method: 'POST',
      body: JSON.stringify({ startDate, endDate })
    });
    
    if (!res.ok) throw new Error('Failed to generate sales report');
    
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    
    let filename = 'Sales_Report';
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate).toISOString().split('T')[0] : 'All';
      const end = endDate ? new Date(endDate).toISOString().split('T')[0] : 'All';
      filename += `_${start}_to_${end}`;
    } else {
      filename += '_All_Sales';
    }
    filename += `_${Date.now()}.pdf`;
    
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    
    showToast('Sales Report Generated Successfully!', 'success');
    
  } catch (e) {
    console.error('Sales report error:', e);
    showToast('Failed to generate sales report.', 'error');
  }
}

// =========================================
// Folder Management for Documents - FIXED DELETE
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
      showToast('Folder created successfully!', 'success');
    } else {
      const error = await res.json();
      showToast(`Failed to create folder: ${error.message}`, 'error');
    }
  } catch (err) {
    console.error('Create folder error:', err);
    showToast('Server error while creating folder.', 'error');
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
      showToast('Folder renamed successfully!', 'success');
    } else {
      const error = await res.json();
      showToast(`Failed to rename folder: ${error.message}`, 'error');
    }
  } catch (err) {
    console.error('Rename folder error:', err);
    showToast('Server error while renaming folder.', 'error');
  }
}

// FIXED: Folder Delete with better error handling
async function deleteFolder(folderId) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;
  
  const confirmed = await showConfirmation(
    'Delete Folder',
    `Are you sure you want to delete folder "${folder.name}"?\n\nThis will also delete all documents inside the folder.`,
    'Delete',
    'Cancel'
  );
  
  if (!confirmed) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/folders/${folderId}`, {
      method: 'DELETE'
    });
    
    if (res.ok) {
      await fetchFolders();
      await fetchDocuments();
      if (currentFolder === folderId) {
        navigateToFolder('root');
      }
      showToast('Folder deleted successfully!', 'success');
    } else {
      const error = await res.json();
      showToast(`Failed to delete folder: ${error.message}`, 'error');
    }
  } catch (err) {
    console.error('Delete folder error:', err);
    showToast('Server error while deleting folder: ' + (err.message || 'Unknown error'), 'error');
  }
}

// =========================================
// Document Management with Folders
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
      <td>${escapeHtml(d.date||'')}</td>
      <td>${displayType}</td>
      <td class="actions">
        <div class="action-buttons-horizontal">
          <button class="primary-btn small-btn download-btn" data-id="${id}" data-name="${escapeHtml(d.name||'')}">
            ⬇️ Download
          </button>
          <button class="danger-btn small-btn delete-btn" data-id="${id}">🗑️ Delete</button>
          <button class="info-btn small-btn preview-btn" data-id="${id}" data-name="${escapeHtml(d.name||'')}" title="Preview">👁️ Preview</button>
        </div>
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

  const confirmed = await showConfirmation(
    'Upload File',
    `Confirm Upload: Upload file "${file.name}" (${(file.size / (1024*1024)).toFixed(2)} MB)?`,
    'Upload',
    'Cancel'
  );
  
  if (!confirmed) { 
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
      showToast(`Successfully uploaded: "${file.name}"`, 'success');
      await fetchDocuments();
      
    } else {
      const errorData = await res.json().catch(() => ({ message: 'Unknown server error' }));
      throw new Error(errorData.message || `Server error: ${res.status}`);
    }
  } catch(e) {
    console.error('❌ Upload error:', e);
    showMsg(msgEl, `❌ Upload failed: ${e.message}`, 'red');
    showToast(`Upload failed: ${e.message}`, 'error');
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
    document.body.classList.add('modal-open');
  }
}

function closePreviewModal() {
  const modal = qs('#previewModal');
  const iframe = qs('#previewIframe');
  
  if (modal && iframe) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    iframe.src = '';
  }
}

function searchDocuments() {
  const q = (qs('#searchDocs')?.value || '').toLowerCase().trim();
  const filtered = documents.filter(d => (d.name||'').toLowerCase().includes(q) || (d.date? d.date.toLowerCase() : '').includes(q));
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
  const confirmed = await showConfirmation('Download File', `Confirm Download: ${fileName}?`, 'Download', 'Cancel');
  
  if(!confirmed) return;
  
  try {
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

    if (!contentLength || contentLength === '0') {
      throw new Error('File is empty or not properly stored');
    }

    const blob = await res.blob();

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
    
    showToast(`Downloaded: ${fileName}`, 'success');

  } catch (error) {
    console.error('Download error:', error);
    showToast(`Download Failed: ${error.message}`, 'error');
    
    if (fileName.includes('Inventory_Report')) {
      const generateNew = await showConfirmation(
        'Corrupted File',
        'This report file appears to be corrupted. Would you like to generate a new one?',
        'Generate New',
        'Cancel'
      );
      
      if (generateNew && fileName.endsWith('.pdf')) {
        generateInventoryReport();
      }
    }
  }
}

async function deleteDocumentConfirm(id) {
  const doc = documents.find(d => String(d.id) === String(id));
  if(!doc) {
    showToast('Document not found in local list', 'error');
    return;
  }
  
  const confirmed = await showConfirmation('Delete Document', `Delete document: ${doc.name}?`, 'Delete', 'Cancel');
  
  if(!confirmed) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/documents/${id}`, { method: 'DELETE' });
    
    if(res.status === 204 || res.ok) { 
      // Remove from local array and update UI
      documents = documents.filter(d => String(d.id) !== String(id));
      renderDocuments(documents);
      showToast('Document deleted successfully!', 'success'); 
    } else {
      const errorData = await res.json().catch(() => ({ message: 'Unknown error' }));
      showToast('Failed to delete document: ' + errorData.message, 'error');
    }
  } catch(e) { 
    console.error('Delete error:', e); 
    showToast('Server error while deleting document: ' + e.message, 'error'); 
  }
}

async function cleanupCorruptedDocuments() {
  const confirmed = await showConfirmation(
    'Cleanup Documents',
    'This will remove all documents that are corrupted or have 0 bytes. Continue?',
    'Continue',
    'Cancel'
  );
  
  if (!confirmed) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/cleanup-documents`, { method: 'DELETE' });
    const data = await res.json();
    
    if (data.success) {
      showToast(`Cleanup completed! Removed ${data.deletedCount} corrupted documents.`, 'success');
      await fetchDocuments();
    } else {
      showToast('Cleanup failed: ' + data.message, 'error');
    }
  } catch (e) {
    console.error('Cleanup error:', e);
    showToast('Cleanup failed: ' + e.message, 'error');
  }
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
    const timeStr = log.time || "N/A";
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
      const timeStr = l.time || 'N/A';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(l.user||'Admin')}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(timeStr)}</td>`;
      tbody.appendChild(tr);
    });
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
  if(!user || !pass) { 
    showMsg(msg, '⚠️ Please enter username and password.', 'red'); 
    return; 
  }

  try {
    const res = await apiFetch(`${API_BASE}/login`, { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
    const data = await res.json();
    if(res.ok) {
      sessionStorage.setItem('isLoggedIn', 'true');
      sessionStorage.setItem('adminName', user);
      showMsg(msg, '✅ Login successful! Redirecting...', 'green');
      showToast('Login successful! Redirecting...', 'success');
      setTimeout(()=> window.location.href = 'inventory.html', 700);
    } else {
      showMsg(msg, `❌ ${data.message || 'Login failed.'}`, 'red');
      showToast(data.message || 'Login failed.', 'error');
    }
  } catch(e) {
    showMsg(msg, '❌ Server connection failed.', 'red');
    showToast('Server connection failed.', 'error');
    console.error(e);
  }
}

async function register(){
  const user = qs('#newUsername')?.value?.trim();
  const pass = qs('#newPassword')?.value?.trim();
  const code = qs('#securityCode')?.value?.trim();
  const msg = qs('#registerMessage');
  showMsg(msg, '');
  if(!user || !pass || !code) { 
    showMsg(msg, '⚠️ Please fill in all fields.', 'red'); 
    return; 
  }

  try {
    const res = await apiFetch(`${API_BASE}/register`, { method: 'POST', body: JSON.stringify({ username: user, password: pass, securityCode: code }) });
    const data = await res.json();
    if(res.ok) {
      showMsg(msg, '✅ Registered successfully! You can now log in.', 'green');
      showToast('Registered successfully! You can now log in.', 'success');
      setTimeout(()=> toggleForm(), 900);
    } else {
      showMsg(msg, `❌ ${data.message || 'Registration failed.'}`, 'red');
      showToast(data.message || 'Registration failed.', 'error');
    }
  } catch(e) { 
    showMsg(msg, '❌ Server connection failed.', 'red'); 
    showToast('Server connection failed.', 'error');
    console.error(e); 
  }
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
    if(!newPass || !confPass || !code) { 
      return showMsg(msgEl, '⚠️ Please fill in all fields.', 'red'); 
    }
    if(newPass !== confPass) { 
      return showMsg(msgEl, '⚠️ New password and confirmation do not match.', 'red'); 
    }
    
    const confirmed = await showConfirmation(
      'Change Password',
      'Confirm Password Change? You will be logged out after a successful update.',
      'Change Password',
      'Cancel'
    );
    
    if (!confirmed) return;

    try {
      const res = await apiFetch(`${API_BASE}/account/password`, { method: 'PUT', body: JSON.stringify({ username: currentUsername, newPassword: newPass, securityCode: code }) });
      const data = await res.json();
      if(res.ok) {
        showMsg(msgEl, '✅ Password updated successfully! Please log in again.', 'green');
        showToast('Password updated successfully! Please log in again.', 'success');
        qs('#newPassword').value = '';
        qs('#confirmPassword').value = '';
        qs('#securityCode').value = '';
        setTimeout(logout, 1500);
      } else {
        showMsg(msgEl, `❌ ${data.message || 'Failed to change password.'}`, 'red');
        showToast(data.message || 'Failed to change password.', 'error');
      }
    } catch(e) { 
      showMsg(msgEl, '❌ Server connection failed during password change.', 'red'); 
      showToast('Server connection failed during password change.', 'error');
    }
  });

  qs('#deleteAccountBtn')?.addEventListener('click', async ()=> {
    const confirmed = await showConfirmation(
      'Delete Account',
      `WARNING: Are you absolutely sure you want to delete the account for "${currentUsername}"?`,
      'Continue',
      'Cancel'
    );
    
    if(!confirmed) return;
    
    const code = prompt('Enter Admin Security Code to CONFIRM account deletion:');
    if(!code) {
      showToast('Deletion cancelled.', 'info');
      return;
    }
    
    try {
      const res = await apiFetch(`${API_BASE}/account`, { method: 'DELETE', body: JSON.stringify({ username: currentUsername, securityCode: code }) });
      const data = await res.json();
      if(res.ok) { 
        showToast('Account deleted successfully. You will now be logged out.', 'success'); 
        logout(); 
      }
      else {
        showToast(`Failed to delete account: ${data.message}`, 'error');
      }
    } catch(e) { 
      showToast('Server connection failed during account deletion.', 'error'); 
    }
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
// ENHANCED UI BINDING WITH PAYMENT LOGIC
// =========================================
function bindInventoryUI(){
  // Add Product Modal button
  qs('#addNewProductBtn')?.addEventListener('click', openAddProductModal);
  
  // Add Product button inside the modal
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  
  // Bind the close button for Add Product Modal
  qs('#closeAddProductModal')?.addEventListener('click', closeAddProductModal);
  
  // Edit Product Modal buttons
  const updateProductBtn = qs('#updateProductBtn');
  if (updateProductBtn) {
    updateProductBtn.addEventListener('click', updateProduct);
  }
  
  const closeEditProductModalBtn = qs('#closeEditProductModal');
  if (closeEditProductModalBtn) {
    closeEditProductModalBtn.addEventListener('click', closeEditProductModal);
  }
  
  // Confirmation modal close button
  qs('#closeConfirmationModal')?.addEventListener('click', closeConfirmationModal);
  
  // Other existing bindings
  qs('#reportBtn')?.addEventListener('click', openReportModal);
  qs('#searchInput')?.addEventListener('input', searchInventory);
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { 
    if(qs('#searchInput')) { 
      qs('#searchInput').value=''; 
      searchInventory(); 
    } 
  });
  
  // Sales buttons
  qs('#salesHistoryBtn')?.addEventListener('click', openSalesHistoryModal);
  qs('#newSalesBtn')?.addEventListener('click', openNewSalesModal);
  
  // Payment method change listener
  const paymentMethodSelect = qs('#paymentMethod');
  if (paymentMethodSelect) {
    paymentMethodSelect.addEventListener('change', updatePaymentFieldsVisibility);
  }
  
  // Amount received input listener
  const amountReceivedInput = qs('#amountReceived');
  if (amountReceivedInput) {
    amountReceivedInput.addEventListener('input', calculateChange);
  }
  
  // Other modal bindings
  qs('#saveSalesBtn')?.addEventListener('click', saveSalesOrder);
  qs('#closeSalesModal')?.addEventListener('click', closeNewSalesModal);
  
  qs('#generateReportBtn')?.addEventListener('click', generateSelectedReport);
  qs('#closeReportModal')?.addEventListener('click', closeReportModal);
  
  // Close buttons for detail modals
  qs('#closePurchaseDetailsModal')?.addEventListener('click', closePurchaseDetailsModal);
  qs('#closeSalesDetailsModal')?.addEventListener('click', closeSalesDetailsModal);
  
  // Company info modal binding
  qs('#closeCompanyInfoModal')?.addEventListener('click', closeCompanyInfoModal);
  qs('#saveCompanyInfoBtn')?.addEventListener('click', updateCompanyInfo);
  
  // Preview Modal Close Button Binding
  const previewCloseBtn = qs('#previewModal .close');
  if (previewCloseBtn) {
    previewCloseBtn.addEventListener('click', closePreviewModal);
  }
  
  // Bind all close buttons with class "close" (for backward compatibility)
  qsa('.close').forEach(closeBtn => {
    closeBtn.addEventListener('click', function() {
      const modal = this.closest('.modal');
      if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
      }
    });
  });
  
  window.addEventListener('click', (e) => {
    const modals = [
      '#addProductModal', '#editProductModal', '#purchaseHistoryModal',
      '#newPurchaseModal', '#salesHistoryModal', '#newSalesModal',
      '#reportModal', '#previewModal', '#purchaseDetailsModal',
      '#salesDetailsModal', '#companyInfoModal', '#confirmationModal'
    ];
    
    modals.forEach(modalSelector => {
      const modal = qs(modalSelector);
      if (modal && e.target === modal) {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
      }
    });
  });
  
  bindDateRangeFilterEvents();
  bindInventoryPaginationEvents();
  bindSalesSearchEvents();
  bindSalesPaginationEvents();
}

function bindDocumentsUI(){
  qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments);
  qs('#searchDocs')?.addEventListener('input', searchDocuments);
  qs('#createFolderBtn')?.addEventListener('click', createFolder);
  qs('#navigateToRoot')?.addEventListener('click', () => navigateToFolder('root'));
  
  // Bind preview modal close button for documents page
  const previewCloseBtn = qs('#previewModal .close');
  if (previewCloseBtn) {
    previewCloseBtn.addEventListener('click', closePreviewModal);
  }
  
  // Also bind window click to close preview modal
  window.addEventListener('click', (e) => {
    if (e.target === qs('#previewModal')) {
      closePreviewModal();
    }
  });
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
    showToast('Error loading data. Please refresh the page.', 'error');
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
  showToast(message, 'info');
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

window.previewDocument = previewDocument;
window.closePreviewModal = closePreviewModal;

window.createFolder = createFolder;
window.renameFolder = renameFolder;
window.deleteFolder = deleteFolder;
window.navigateToFolder = navigateToFolder;

window.updateCompanyInfo = updateCompanyInfo;
window.openCompanyInfoModal = openCompanyInfoModal;
window.closeCompanyInfoModal = closeCompanyInfoModal;

window.login = login;
window.register = register;
window.toggleForm = toggleForm;

// Search and Pagination functions
window.searchPurchases = searchPurchases;
window.clearPurchaseSearch = clearPurchaseSearch;
window.applyPurchaseDateRangeFilter = applyPurchaseDateRangeFilter;

window.searchSales = searchSales;
window.clearSalesSearch = clearSalesSearch;
window.applySalesDateRangeFilter = applySalesDateRangeFilter;

// Add Product Modal Functions
window.openAddProductModal = openAddProductModal;
window.closeAddProductModal = closeAddProductModal;
window.confirmAndAddProduct = confirmAndAddProduct;

// Edit Product Functions
window.openEditProductModal = openEditProductModal;
window.closeEditProductModal = closeEditProductModal;
window.updateProduct = updateProduct;

// Payment Functions
window.updatePaymentFieldsVisibility = updatePaymentFieldsVisibility;
window.calculateChange = calculateChange;
window.validatePayment = validatePayment;

// Toast Functions
window.showToast = showToast;
window.removeToast = removeToast;

// Confirmation Modal Functions
window.showConfirmation = showConfirmation;
window.closeConfirmationModal = closeConfirmationModal;

// New function to handle edit button clicks
window.handleEditClick = async function(productId) {
  await openEditProductModal(productId);
};
