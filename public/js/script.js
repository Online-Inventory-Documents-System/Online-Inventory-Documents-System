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
const currentPage = window.location.pathname.split('/').pop();

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
  if(window.CONFIG && CONFIG.LS_THEME) localStorage.removeItem(CONFIG.LS_THEME);
  window.location.href = 'login.html';
}

function toggleTheme(){
  document.body.classList.toggle('dark-mode');
  if(window.CONFIG && CONFIG.LS_THEME) {
    localStorage.setItem(CONFIG.LS_THEME, document.body.classList.contains('dark-mode') ? 'dark' : 'light');
  }
}

// Renderers
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

    // Format the date - NEW DATE COLUMN
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

  // Update modern summary cards instead of old totals
  if(qs('#cardTotalValue')) qs('#cardTotalValue').textContent = `RM ${totalValue.toFixed(2)}`;
  if(qs('#cardTotalRevenue')) qs('#cardTotalRevenue').textContent = `RM ${totalRevenue.toFixed(2)}`;
  if(qs('#cardTotalProfit')) qs('#cardTotalProfit').textContent = `RM ${totalProfit.toFixed(2)}`;
  if(qs('#cardTotalStock')) qs('#cardTotalStock').textContent = totalStock;
}

// =========================================
// UPDATED: Date Range Filtering Functions
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

// Update the renderDocuments function to be more accurate
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
      </td>
    `;
    list.appendChild(tr);
  });

  bindDocumentEvents();
}

// Add verification function
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
        confirmAndGeneratePDF();
      } else if (fileName.endsWith('.xlsx')) {
        confirmAndGenerateReport();
      }
    }
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

// Fetchers
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

async function fetchDocuments() {
  try {
    const res = await apiFetch(`${API_BASE}/documents`);
    if(!res.ok) throw new Error('Failed to fetch documents');
    const data = await res.json();
    documents = data.map(d => ({ ...d, id: d.id || d._id }));
    renderDocuments(documents);
  } catch(err) { console.error(err); }
}

async function fetchLogs() {
  try {
    const res = await apiFetch(`${API_BASE}/logs`);
    if(!res.ok) throw new Error('Failed to fetch logs');
    activityLog = await res.json();
    renderLogs();
  } catch(err) { console.error(err); }
}

// Purchase-related functions
async function fetchPurchases() {
  try {
    const res = await apiFetch(`${API_BASE}/purchases`);
    if(!res.ok) throw new Error('Failed to fetch purchases');
    const data = await res.json();
    purchases = data.map(p => ({ ...p, id: p.id || p._id }));
    
    // Update purchase summary cards if on purchase page
    if (currentPage.includes('purchase')) {
      updatePurchaseSummaryCards();
    }
  } catch(err) { 
    console.error('Error fetching purchases:', err);
    // If API fails, try to load from localStorage
    const savedPurchases = localStorage.getItem('purchaseHistory');
    if (savedPurchases) {
      purchases = JSON.parse(savedPurchases);
      if (currentPage.includes('purchase')) {
        updatePurchaseSummaryCards();
      }
    }
  }
}

// Update purchase summary cards
function updatePurchaseSummaryCards() {
  if (!currentPage.includes('purchase')) return;
  
  const totalPurchase = purchases.reduce((sum, purchase) => sum + purchase.total, 0);
  const totalItems = purchases.reduce((sum, purchase) => sum + purchase.totalQuantity, 0);
  
  // Calculate monthly purchases
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const monthlyPurchases = purchases.filter(p => {
    const purchaseDate = new Date(p.date);
    return purchaseDate.getMonth() === currentMonth && purchaseDate.getFullYear() === currentYear;
  }).length;
  
  // Calculate average purchase
  const avgPurchase = purchases.length > 0 ? totalPurchase / purchases.length : 0;
  
  // Update cards
  if(qs('#cardTotalPurchase')) qs('#cardTotalPurchase').textContent = `RM ${totalPurchase.toFixed(2)}`;
  if(qs('#cardMonthlyPurchases')) qs('#cardMonthlyPurchases').textContent = monthlyPurchases;
  if(qs('#cardAvgPurchase')) qs('#cardAvgPurchase').textContent = `RM ${avgPurchase.toFixed(2)}`;
  if(qs('#cardTotalItems')) qs('#cardTotalItems').textContent = totalItems;
}

// Initialize purchase page
function initPurchasePage() {
  // Load purchase history from localStorage or API
  const savedHistory = localStorage.getItem('purchaseHistory');
  if (savedHistory) {
    purchases = JSON.parse(savedHistory);
  }
  
  // Load inventory from localStorage or API
  const savedInventory = localStorage.getItem('inventory');
  if (savedInventory) {
    inventory = JSON.parse(savedInventory);
  } else {
    // If no inventory in localStorage, try to get from the main inventory
    try {
      if (window.inventory && Array.isArray(window.inventory)) {
        inventory = window.inventory;
      }
    } catch (e) {
      console.log('Could not load inventory from main app');
    }
  }
}

// Load inventory data for purchase page
function loadInventoryForPurchase() {
  // In a real app, this would be an API call
  // For now, we'll use mock data or load from localStorage
  const productSelect = qs('#productSelect');
  if (!productSelect) return;
  
  productSelect.innerHTML = '<option value="">-- Select a product --</option>';
  
  // If we have inventory data, populate the dropdown
  if (inventory && inventory.length > 0) {
    inventory.forEach(product => {
      const option = document.createElement('option');
      option.value = product.id || product._id;
      option.textContent = `${product.name} (${product.sku}) - RM ${product.unitCost?.toFixed(2) || '0.00'}`;
      option.dataset.price = product.unitCost || 0;
      productSelect.appendChild(option);
    });
  } else {
    // Add some sample products if no inventory exists
    const sampleProducts = [
      { id: '1', name: 'Product A', sku: 'PROD-A', unitCost: 10.50 },
      { id: '2', name: 'Product B', sku: 'PROD-B', unitCost: 15.75 },
      { id: '3', name: 'Product C', sku: 'PROD-C', unitCost: 8.25 }
    ];
    
    sampleProducts.forEach(product => {
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = `${product.name} (${product.sku}) - RM ${product.unitCost.toFixed(2)}`;
      option.dataset.price = product.unitCost;
      productSelect.appendChild(option);
    });
  }
}

// Bind purchase UI events
function bindPurchaseUI() {
  // Add item button
  const addItemBtn = qs('#addItemBtn');
  if (addItemBtn) {
    addItemBtn.addEventListener('click', addPurchaseItem);
  }
  
  // Save purchase button
  const savePurchaseBtn = qs('#savePurchaseBtn');
  if (savePurchaseBtn) {
    savePurchaseBtn.addEventListener('click', savePurchase);
  }
  
  // Clear purchase button
  const clearPurchaseBtn = qs('#clearPurchaseBtn');
  if (clearPurchaseBtn) {
    clearPurchaseBtn.addEventListener('click', clearPurchaseForm);
  }
  
  // Product selection change
  const productSelect = qs('#productSelect');
  if (productSelect) {
    productSelect.addEventListener('change', function() {
      const selectedOption = this.options[this.selectedIndex];
      if (selectedOption && selectedOption.dataset.price) {
        qs('#purchasePrice').value = selectedOption.dataset.price;
      }
    });
  }
  
  // PDF report button
  const pdfReportBtn = qs('#pdfReportBtn');
  if (pdfReportBtn) {
    pdfReportBtn.addEventListener('click', generatePurchasePDF);
  }
  
  // History filter buttons
  const applyHistoryFilter = qs('#applyHistoryFilter');
  if (applyHistoryFilter) {
    applyHistoryFilter.addEventListener('click', applyHistoryFilter);
  }
  
  const clearHistoryFilter = qs('#clearHistoryFilter');
  if (clearHistoryFilter) {
    clearHistoryFilter.addEventListener('click', clearHistoryFilter);
  }
}

// Add item to purchase list
function addPurchaseItem() {
  const productSelect = qs('#productSelect');
  const quantityInput = qs('#purchaseQuantity');
  const priceInput = qs('#purchasePrice');
  
  if (!productSelect || !quantityInput || !priceInput) return;
  
  const productId = productSelect.value;
  const productText = productSelect.options[productSelect.selectedIndex].text;
  const quantity = parseInt(quantityInput.value);
  const price = parseFloat(priceInput.value);
  
  if (!productId || quantity <= 0 || price <= 0) {
    alert('Please select a product and enter valid quantity and price');
    return;
  }
  
  // Check if product already in purchase items
  const existingItemIndex = purchaseItems.findIndex(item => item.productId === productId);
  
  if (existingItemIndex >= 0) {
    // Update existing item
    purchaseItems[existingItemIndex].quantity += quantity;
    purchaseItems[existingItemIndex].total = purchaseItems[existingItemIndex].quantity * purchaseItems[existingItemIndex].price;
  } else {
    // Add new item
    const newItem = {
      productId,
      productName: productText.split(' - ')[0],
      quantity,
      price,
      total: quantity * price
    };
    purchaseItems.push(newItem);
  }
  
  // Update UI
  renderPurchaseItems();
  
  // Clear form inputs
  quantityInput.value = 1;
  priceInput.value = '';
  productSelect.selectedIndex = 0;
}

// Render purchase items in the list
function renderPurchaseItems() {
  const itemsList = qs('#purchaseItemsList');
  if (!itemsList) return;
  
  itemsList.innerHTML = '';
  
  let totalQuantity = 0;
  let grandTotal = 0;
  
  purchaseItems.forEach((item, index) => {
    totalQuantity += item.quantity;
    grandTotal += item.total;
    
    const itemElement = document.createElement('div');
    itemElement.className = 'purchase-item';
    itemElement.innerHTML = `
      <div>${item.productName}</div>
      <div>${item.quantity}</div>
      <div>RM ${item.price.toFixed(2)}</div>
      <div>RM ${item.total.toFixed(2)}</div>
      <div>
        <button class="danger-btn small-btn" onclick="removePurchaseItem(${index})">🗑️</button>
      </div>
    `;
    itemsList.appendChild(itemElement);
  });
  
  // Update totals
  const totalQuantityEl = qs('#totalQuantity');
  const grandTotalEl = qs('#grandTotal');
  
  if (totalQuantityEl) totalQuantityEl.textContent = totalQuantity;
  if (grandTotalEl) grandTotalEl.textContent = `RM ${grandTotal.toFixed(2)}`;
}

// Remove item from purchase list
function removePurchaseItem(index) {
  purchaseItems.splice(index, 1);
  renderPurchaseItems();
}

// Save purchase
function savePurchase() {
  const purchaseDate = qs('#purchaseDate');
  const supplierName = qs('#supplierName');
  
  if (!purchaseDate || !supplierName || purchaseItems.length === 0) {
    alert('Please fill in all fields and add at least one item');
    return;
  }
  
  const dateValue = purchaseDate.value;
  const supplierValue = supplierName.value;
  
  if (!dateValue || !supplierValue) {
    alert('Please fill in all fields');
    return;
  }
  
  const grandTotal = purchaseItems.reduce((sum, item) => sum + item.total, 0);
  const totalQuantity = purchaseItems.reduce((sum, item) => sum + item.quantity, 0);
  
  const newPurchase = {
    id: 'PUR-' + Date.now(),
    date: dateValue,
    supplier: supplierValue,
    items: [...purchaseItems],
    total: grandTotal,
    totalQuantity: totalQuantity,
    createdAt: new Date().toISOString()
  };
  
  // Add to purchase history
  purchases.unshift(newPurchase);
  
  // Save to localStorage
  localStorage.setItem('purchaseHistory', JSON.stringify(purchases));
  
  // Update inventory (in a real app, this would be an API call)
  updateInventoryAfterPurchase(newPurchase);
  
  // Log activity
  logPurchaseActivity(newPurchase);
  
  // Show success message
  alert(`Purchase saved successfully!\nTotal: RM ${grandTotal.toFixed(2)}`);
  
  // Clear form and update UI
  clearPurchaseForm();
  loadPurchaseHistory();
  updatePurchaseSummaryCards();
}

// Update inventory after purchase
function updateInventoryAfterPurchase(purchase) {
  purchase.items.forEach(item => {
    const productIndex = inventory.findIndex(p => (p.id === item.productId) || (p._id === item.productId));
    if (productIndex >= 0) {
      // Update product quantity and cost
      inventory[productIndex].quantity = (inventory[productIndex].quantity || 0) + item.quantity;
      // In a real app, you might want to recalculate average cost
      // For simplicity, we're just updating quantity here
    }
  });
  
  // Save updated inventory
  localStorage.setItem('inventory', JSON.stringify(inventory));
  
  // Also update the main inventory if it exists
  if (window.inventory && Array.isArray(window.inventory)) {
    window.inventory = inventory;
  }
}

// Log purchase activity
function logPurchaseActivity(purchase) {
  const activity = {
    user: sessionStorage.getItem('adminName') || 'System',
    action: `Added purchase: ${purchase.id} from ${purchase.supplier} (RM ${purchase.total.toFixed(2)})`,
    time: new Date().toISOString()
  };
  
  // Save to activity log
  let activityLog = JSON.parse(localStorage.getItem('activityLog') || '[]');
  activityLog.unshift(activity);
  localStorage.setItem('activityLog', JSON.stringify(activityLog));
  
  // Also update the main activity log if it exists
  if (window.activityLog && Array.isArray(window.activityLog)) {
    window.activityLog.unshift(activity);
  }
}

// Clear purchase form
function clearPurchaseForm() {
  purchaseItems = [];
  const purchaseDate = qs('#purchaseDate');
  const supplierName = qs('#supplierName');
  const productSelect = qs('#productSelect');
  const quantityInput = qs('#purchaseQuantity');
  const priceInput = qs('#purchasePrice');
  
  if (purchaseDate) purchaseDate.value = new Date().toISOString().split('T')[0];
  if (supplierName) supplierName.value = '';
  if (productSelect) productSelect.selectedIndex = 0;
  if (quantityInput) quantityInput.value = 1;
  if (priceInput) priceInput.value = '';
  
  renderPurchaseItems();
}

// Load purchase history
function loadPurchaseHistory() {
  const historyList = qs('#purchaseHistoryList');
  if (!historyList) return;
  
  if (purchases.length === 0) {
    historyList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🛒</div>
        <h3>No purchases yet</h3>
        <p>Start by adding your first purchase using the form on the left.</p>
      </div>
    `;
    return;
  }
  
  historyList.innerHTML = '';
  
  purchases.forEach(purchase => {
    const purchaseCard = document.createElement('div');
    purchaseCard.className = 'purchase-card fade-in';
    purchaseCard.innerHTML = `
      <div class="purchase-header">
        <div class="purchase-id">${purchase.id}</div>
        <div class="purchase-date">${new Date(purchase.date).toLocaleDateString()}</div>
      </div>
      <div class="purchase-details">
        <div><strong>Supplier:</strong> ${purchase.supplier}</div>
        <div><strong>Items:</strong> ${purchase.items.length}</div>
        <div><strong>Total Quantity:</strong> ${purchase.totalQuantity}</div>
        <div class="purchase-total">RM ${purchase.total.toFixed(2)}</div>
      </div>
      <div style="margin-top: 10px;">
        <button class="primary-btn small-btn" onclick="viewPurchaseDetails('${purchase.id}')">👁️ View Details</button>
        <button class="secondary-btn small-btn" onclick="generatePurchaseInvoice('${purchase.id}')">🧾 Generate Invoice</button>
      </div>
    `;
    historyList.appendChild(purchaseCard);
  });
}

// View purchase details
function viewPurchaseDetails(purchaseId) {
  const purchase = purchases.find(p => p.id === purchaseId);
  if (!purchase) return;
  
  let detailsHtml = `
    <h3>Purchase Details: ${purchase.id}</h3>
    <p><strong>Date:</strong> ${new Date(purchase.date).toLocaleDateString()}</p>
    <p><strong>Supplier:</strong> ${purchase.supplier}</p>
    <table style="width: 100%; margin: 15px 0; border-collapse: collapse;">
      <thead>
        <tr style="background: var(--primary-color); color: white;">
          <th style="padding: 10px; text-align: left;">Product</th>
          <th style="padding: 10px; text-align: center;">Quantity</th>
          <th style="padding: 10px; text-align: right;">Unit Price</th>
          <th style="padding: 10px; text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  purchase.items.forEach(item => {
    detailsHtml += `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">${item.productName}</td>
        <td style="padding: 8px; border-bottom: 1px solid var(--border-color); text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; border-bottom: 1px solid var(--border-color); text-align: right;">RM ${item.price.toFixed(2)}</td>
        <td style="padding: 8px; border-bottom: 1px solid var(--border-color); text-align: right;">RM ${item.total.toFixed(2)}</td>
      </tr>
    `;
  });
  
  detailsHtml += `
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="padding: 8px; text-align: right; font-weight: bold;">Grand Total:</td>
          <td style="padding: 8px; text-align: right; font-weight: bold;">RM ${purchase.total.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
  `;
  
  // Create a modal for better display
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  `;
  
  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background: white;
    padding: 20px;
    border-radius: 10px;
    max-width: 90%;
    max-height: 90%;
    overflow: auto;
    box-shadow: 0 5px 15px rgba(0,0,0,0.3);
  `;
  
  modalContent.innerHTML = detailsHtml + `
    <div style="text-align: center; margin-top: 20px;">
      <button onclick="this.closest('div').parentElement.remove()" class="primary-btn">Close</button>
    </div>
  `;
  
  modal.appendChild(modalContent);
  document.body.appendChild(modal);
  
  // Close modal when clicking outside
  modal.addEventListener('click', function(e) {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// Apply history filter
function applyHistoryFilter() {
  const startDate = qs('#historyStartDate');
  const endDate = qs('#historyEndDate');
  
  if (!startDate || !endDate) return;
  
  const startDateValue = startDate.value;
  const endDateValue = endDate.value;
  
  let filteredHistory = purchases;
  
  if (startDateValue) {
    filteredHistory = filteredHistory.filter(p => p.date >= startDateValue);
  }
  
  if (endDateValue) {
    filteredHistory = filteredHistory.filter(p => p.date <= endDateValue);
  }
  
  // Update UI with filtered history
  const historyList = qs('#purchaseHistoryList');
  if (!historyList) return;
  
  historyList.innerHTML = '';
  
  if (filteredHistory.length === 0) {
    historyList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <h3>No purchases found</h3>
        <p>No purchases match your filter criteria.</p>
      </div>
    `;
    return;
  }
  
  filteredHistory.forEach(purchase => {
    const purchaseCard = document.createElement('div');
    purchaseCard.className = 'purchase-card fade-in';
    purchaseCard.innerHTML = `
      <div class="purchase-header">
        <div class="purchase-id">${purchase.id}</div>
        <div class="purchase-date">${new Date(purchase.date).toLocaleDateString()}</div>
      </div>
      <div class="purchase-details">
        <div><strong>Supplier:</strong> ${purchase.supplier}</div>
        <div><strong>Items:</strong> ${purchase.items.length}</div>
        <div><strong>Total Quantity:</strong> ${purchase.totalQuantity}</div>
        <div class="purchase-total">RM ${purchase.total.toFixed(2)}</div>
      </div>
      <div style="margin-top: 10px;">
        <button class="primary-btn small-btn" onclick="viewPurchaseDetails('${purchase.id}')">👁️ View Details</button>
        <button class="secondary-btn small-btn" onclick="generatePurchaseInvoice('${purchase.id}')">🧾 Generate Invoice</button>
      </div>
    `;
    historyList.appendChild(purchaseCard);
  });
}

// Clear history filter
function clearHistoryFilter() {
  const startDate = qs('#historyStartDate');
  const endDate = qs('#historyEndDate');
  
  if (startDate) startDate.value = '';
  if (endDate) endDate.value = '';
  
  loadPurchaseHistory();
}

// Generate PDF purchase report
function generatePurchasePDF() {
  if (purchases.length === 0) {
    alert('No purchase data available to generate report');
    return;
  }
  
  // In a real app, this would connect to a backend service to generate the PDF
  // For now, we'll create a simple PDF using jsPDF (if available) or show a message
  
  if (typeof jsPDF !== 'undefined') {
    // Use jsPDF to generate a simple PDF
    const doc = new jsPDF();
    
    // Add title
    doc.setFontSize(20);
    doc.text('Purchase Report', 105, 15, { align: 'center' });
    
    // Add date
    doc.setFontSize(12);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 105, 25, { align: 'center' });
    
    // Add table headers
    doc.setFontSize(10);
    doc.text('Purchase ID', 20, 40);
    doc.text('Date', 60, 40);
    doc.text('Supplier', 90, 40);
    doc.text('Total (RM)', 140, 40);
    
    let yPosition = 50;
    
    // Add purchase data
    purchases.forEach(purchase => {
      if (yPosition > 270) {
        doc.addPage();
        yPosition = 20;
      }
      
      doc.text(purchase.id, 20, yPosition);
      doc.text(new Date(purchase.date).toLocaleDateString(), 60, yPosition);
      doc.text(purchase.supplier, 90, yPosition);
      doc.text(purchase.total.toFixed(2), 140, yPosition);
      
      yPosition += 7;
    });
    
    // Add summary
    yPosition += 10;
    doc.setFontSize(12);
    doc.text(`Total Purchases: ${purchases.length}`, 20, yPosition);
    doc.text(`Total Amount: RM ${purchases.reduce((sum, p) => sum + p.total, 0).toFixed(2)}`, 20, yPosition + 7);
    
    // Save the PDF
    doc.save('purchase_report.pdf');
  } else {
    // If jsPDF is not available, show a message
    alert('PDF Purchase Report generation would be implemented here.\nIn a real application, this would connect to a backend service to generate the PDF.');
    
    // Simulate API call
    setTimeout(() => {
      alert('PDF Purchase Report generated successfully!');
    }, 1000);
  }
}

// Generate purchase invoice for a specific purchase
function generatePurchaseInvoice(purchaseId) {
  const purchase = purchases.find(p => p.id === purchaseId);
  if (!purchase) return;
  
  // In a real app, this would be an API call to generate an invoice PDF
  // For now, we'll use jsPDF if available or show a message
  
  if (typeof jsPDF !== 'undefined') {
    const doc = new jsPDF();
    
    // Add company header
    doc.setFontSize(20);
    doc.text('L&B Company', 105, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.text('Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', 105, 30, { align: 'center' });
    doc.text('Phone: 01133127622 | Email: lbcompany@gmail.com', 105, 37, { align: 'center' });
    
    // Add invoice title
    doc.setFontSize(16);
    doc.text('PURCHASE INVOICE', 105, 50, { align: 'center' });
    
    // Add invoice details
    doc.setFontSize(10);
    doc.text(`Invoice Number: ${purchase.id}`, 20, 65);
    doc.text(`Date: ${new Date(purchase.date).toLocaleDateString()}`, 20, 72);
    doc.text(`Supplier: ${purchase.supplier}`, 20, 79);
    
    // Add table headers
    doc.text('Product', 20, 95);
    doc.text('Quantity', 100, 95);
    doc.text('Unit Price', 130, 95);
    doc.text('Total', 170, 95);
    
    // Add line
    doc.line(20, 97, 190, 97);
    
    let yPosition = 105;
    
    // Add items
    purchase.items.forEach(item => {
      doc.text(item.productName, 20, yPosition);
      doc.text(item.quantity.toString(), 100, yPosition);
      doc.text(`RM ${item.price.toFixed(2)}`, 130, yPosition);
      doc.text(`RM ${item.total.toFixed(2)}`, 170, yPosition);
      yPosition += 7;
    });
    
    // Add total
    yPosition += 10;
    doc.setFontSize(12);
    doc.text('Grand Total:', 130, yPosition);
    doc.text(`RM ${purchase.total.toFixed(2)}`, 170, yPosition);
    
    // Add footer
    yPosition += 20;
    doc.setFontSize(10);
    doc.text('Thank you for your business!', 105, yPosition, { align: 'center' });
    
    // Save the PDF
    doc.save(`invoice_${purchase.id}.pdf`);
  } else {
    alert(`Generating invoice for purchase ${purchaseId}...\n\nIn a real application, this would generate a professional invoice PDF.`);
    
    // Simulate API call
    setTimeout(() => {
      alert(`Invoice for ${purchaseId} generated successfully!`);
    }, 1000);
  }
}

// Init
window.addEventListener('load', async () => {
  const adminName = getUsername();
  if(qs('#adminName')) qs('#adminName').textContent = adminName;

  const theme = (window.CONFIG && CONFIG.LS_THEME) ? localStorage.getItem(CONFIG.LS_THEME) : null;
  if(theme === 'dark') document.body.classList.add('dark-mode');

  try {
    if(currentPage.includes('inventory')) { 
      await fetchInventory(); 
      bindInventoryUI(); 
    }
    if(currentPage.includes('documents')) { 
      await fetchDocuments(); 
      bindDocumentsUI(); 
    }
    if(currentPage.includes('log') || currentPage === '' || currentPage === 'index.html') { 
      await fetchLogs(); 
      await fetchInventory(); 
    }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
    if(currentPage.includes('purchase')) {
      // Initialize purchase page
      initPurchasePage();
      bindPurchaseUI();
      loadPurchaseHistory();
      loadInventoryForPurchase();
      
      // Set default date to today
      const today = new Date().toISOString().split('T')[0];
      if (qs('#purchaseDate')) qs('#purchaseDate').value = today;
      
      // Update summary cards
      updatePurchaseSummaryCards();
    }
  } catch(e) { console.error('Init error', e); }
});

// Auth
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
      setTimeout(()=> window.location.href = 'index.html', 700);
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

// Inventory CRUD
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

async function confirmAndGenerateReport() {
  if(!confirm('Confirm Generate Report: This will create and save a new Excel file.')) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory/report`, { method: 'GET' });
    if(res.ok) {
      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition ? contentDisposition.match(/filename="(.+?)"/) : null;
      const filename = filenameMatch ? filenameMatch[1] : `Inventory_Report_${Date.now()}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      await fetchDocuments();
      alert(`Report "${filename}" successfully generated and saved to Documents!`);
    } else {
      try {
        const error = await res.json();
        alert(`Failed to generate report: ${error.message}`);
      } catch(e) {
        alert('Failed to generate report: Server did not return a valid message.');
      }
    }
  } catch(e) {
    console.error('Report generation error:', e);
    alert('An error occurred during report generation. Check console for details.');
  }
}

async function confirmAndGeneratePDF() {
  if(!confirm("Generate PDF Inventory Report?")) return;

  try {
    const res = await apiFetch(`${API_BASE}/inventory/report/pdf`, { method: 'GET' });

    if(!res.ok) {
      try {
        const err = await res.json();
        alert(`Failed to generate PDF: ${err.message || 'Server error'}`);
      } catch (_) {
        alert("Failed to generate PDF.");
      }
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    const contentDisposition = res.headers.get('Content-Disposition');
    const filenameMatch = contentDisposition ? contentDisposition.match(/filename="(.+?)"/) : null;
    const filename = filenameMatch ? filenameMatch[1] : `Inventory_Report_${Date.now()}.pdf`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);
    await fetchDocuments();
    alert("PDF Report Generated Successfully!");
  } catch (e) {
    console.error(e);
    alert("PDF Generation Failed.");
  }
}

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport);
  qs('#pdfReportBtn')?.addEventListener('click', confirmAndGeneratePDF);
  qs('#searchInput')?.addEventListener('input', searchInventory);
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { 
    if(qs('#searchInput')) { 
      qs('#searchInput').value=''; 
      searchInventory(); 
    } 
  });
  
  // UPDATED: Bind date range filter events
  bindDateRangeFilterEvents();
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

// Product (edit)
function openEditPageForItem(id){ window.location.href = `product.html?id=${encodeURIComponent(id)}`; }

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

// Documents
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
    console.log(`Starting upload: ${file.name}, size: ${file.size} bytes, type: ${file.type}`);
    
    // Read file as ArrayBuffer
    const fileBuffer = await file.arrayBuffer();
    
    if (!fileBuffer || fileBuffer.byteLength === 0) {
      throw new Error("File reading failed - empty buffer");
    }

    console.log(`File read successfully: ${fileBuffer.byteLength} bytes`);
    
    // Convert ArrayBuffer to Buffer for upload
    const uint8Array = new Uint8Array(fileBuffer);
    
    const res = await fetch(`${API_BASE}/documents`, { 
        method: 'POST', 
        body: uint8Array,
        headers: {
            'Content-Type': file.type || 'application/octet-stream', 
            'X-Username': getUsername(),
            'X-File-Name': encodeURIComponent(file.name),
            'Content-Length': fileBuffer.byteLength.toString()
        }
    });

    console.log(`Upload response status: ${res.status}`);

    if(res.ok) {
      const result = await res.json();
      console.log('Upload successful, server response:', result);
      
      showMsg(msgEl, `✅ Successfully uploaded: "${file.name}" (${(file.size / (1024*1024)).toFixed(2)} MB)`, 'green');
      
      // Refresh documents list
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
  
  // Clear input and remove message
  if(fileInput) fileInput.value = '';
  setTimeout(() => { 
    if(msgEl) {
      msgEl.remove(); 
    }
  }, 3000);
}

// Update delete function
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

function searchDocuments() {
  const q = (qs('#searchDocs')?.value || '').toLowerCase().trim();
  const filtered = documents.filter(d => (d.name||'').toLowerCase().includes(q) || (d.date? new Date(d.date).toLocaleString().toLowerCase() : '').includes(q));
  renderDocuments(filtered);
}

function bindDocumentsUI(){
  qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments);
  qs('#searchDocs')?.addEventListener('input', searchDocuments);
}

// Settings
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

// DOM bindings
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

// Expose functions for inline onclick handlers
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;
window.verifyDocument = verifyDocument;
window.cleanupCorruptedDocuments = cleanupCorruptedDocuments;
window.showCardTooltip = showCardTooltip;

// Purchase-related global variables and functions
let purchaseItems = [];

// Expose purchase functions to global scope
window.removePurchaseItem = removePurchaseItem;
window.viewPurchaseDetails = viewPurchaseDetails;
window.generatePurchaseInvoice = generatePurchaseInvoice;
