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

  if(qs('#totalValue')) qs('#totalValue').textContent = totalValue.toFixed(2);
  if(qs('#totalRevenue')) qs('#totalRevenue').textContent = totalRevenue.toFixed(2);
  if(qs('#totalProfit')) qs('#totalProfit').textContent = totalProfit.toFixed(2);
  if(qs('#totalStock')) qs('#totalStock').textContent = totalStock;
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
    qs('#dash_totalValue').textContent = totalValue.toFixed(2);
    qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
    qs('#dash_totalProfit').textContent = totalProfit.toFixed(2);
    qs('#dash_totalStock').textContent = totalStock;
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

// =========================================
// NEW: Purchase & Sales Fetchers
// =========================================
async function fetchPurchases() {
  try {
    const res = await apiFetch(`${API_BASE}/purchases`);
    if (!res.ok) throw new Error('Failed to fetch purchases');
    purchases = await res.json();
    renderPurchases(purchases);
  } catch (err) {
    console.error('Purchase fetch error:', err);
  }
}

async function fetchSales() {
  try {
    const res = await apiFetch(`${API_BASE}/sales`);
    if (!res.ok) throw new Error('Failed to fetch sales');
    sales = await res.json();
    renderSales(sales);
  } catch (err) {
    console.error('Sales fetch error:', err);
  }
}

// =========================================
// NEW: Purchase & Sales Renderers
// =========================================
function renderPurchases(purchaseList) {
  const list = qs('#purchaseList');
  if (!list) return;
  list.innerHTML = '';
  
  let totalQty = 0;
  let totalAmount = 0;
  
  purchaseList.forEach(purchase => {
    const id = purchase.id || purchase._id;
    const qty = Number(purchase.quantity || 0);
    const unitCost = Number(purchase.unitCost || 0);
    const totalCost = qty * unitCost;
    
    totalQty += qty;
    totalAmount += totalCost;
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(purchase.date).toLocaleDateString()}</td>
      <td>${escapeHtml(purchase.invoiceNo || '')}</td>
      <td>${escapeHtml(purchase.supplier || '')}</td>
      <td>${escapeHtml(purchase.sku || '')}</td>
      <td>${escapeHtml(purchase.productName || '')}</td>
      <td>${escapeHtml(purchase.category || '')}</td>
      <td>${qty}</td>
      <td class="money">RM ${unitCost.toFixed(2)}</td>
      <td class="money">RM ${totalCost.toFixed(2)}</td>
      <td class="actions">
        <button class="danger-btn small-btn" onclick="deletePurchase('${id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });
  
  if (qs('#totalPurchaseQty')) qs('#totalPurchaseQty').textContent = totalQty;
  if (qs('#totalPurchaseAmount')) qs('#totalPurchaseAmount').textContent = totalAmount.toFixed(2);
  if (qs('#totalPurchaseTransactions')) qs('#totalPurchaseTransactions').textContent = purchaseList.length;
}

function renderSales(salesList) {
  const list = qs('#salesList');
  if (!list) return;
  list.innerHTML = '';
  
  let totalQty = 0;
  let totalRevenue = 0;
  let totalProfit = 0;
  
  salesList.forEach(sale => {
    const id = sale.id || sale._id;
    const qty = Number(sale.quantity || 0);
    const unitPrice = Number(sale.unitPrice || 0);
    const unitCost = Number(sale.unitCost || 0);
    const totalPrice = qty * unitPrice;
    const profit = (unitPrice - unitCost) * qty;
    
    totalQty += qty;
    totalRevenue += totalPrice;
    totalProfit += profit;
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(sale.date).toLocaleDateString()}</td>
      <td>${escapeHtml(sale.invoiceNo || '')}</td>
      <td>${escapeHtml(sale.customer || '')}</td>
      <td>${escapeHtml(sale.sku || '')}</td>
      <td>${escapeHtml(sale.productName || '')}</td>
      <td>${escapeHtml(sale.category || '')}</td>
      <td>${qty}</td>
      <td class="money">RM ${unitPrice.toFixed(2)}</td>
      <td class="money">RM ${totalPrice.toFixed(2)}</td>
      <td class="money">RM ${profit.toFixed(2)}</td>
      <td class="actions">
        <button class="danger-btn small-btn" onclick="deleteSale('${id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });
  
  if (qs('#totalSalesQty')) qs('#totalSalesQty').textContent = totalQty;
  if (qs('#totalSalesRevenue')) qs('#totalSalesRevenue').textContent = totalRevenue.toFixed(2);
  if (qs('#totalSalesProfit')) qs('#totalSalesProfit').textContent = totalProfit.toFixed(2);
  if (qs('#totalSalesTransactions')) qs('#totalSalesTransactions').textContent = salesList.length;
}

// =========================================
// NEW: Purchase & Sales CRUD Operations
// =========================================
async function addPurchase() {
  const sku = qs('#purchase_sku')?.value?.trim();
  const productName = qs('#purchase_name')?.value?.trim();
  const category = qs('#purchase_category')?.value?.trim();
  const quantity = Number(qs('#purchase_quantity')?.value || 0);
  const unitCost = Number(qs('#purchase_unitCost')?.value || 0);
  const supplier = qs('#purchase_supplier')?.value?.trim();
  const invoiceNo = qs('#purchase_invoiceNo')?.value?.trim();
  
  if (!sku || !productName || !quantity || !unitCost || !supplier) {
    return alert('⚠️ Please fill in all required fields (SKU, Product, Quantity, Unit Cost, Supplier).');
  }
  
  if (!confirm(`Confirm Purchase: ${quantity} x ${productName} from ${supplier} for RM ${(quantity * unitCost).toFixed(2)}?`)) return;
  
  const purchaseData = {
    sku,
    productName,
    category,
    quantity,
    unitCost,
    supplier,
    invoiceNo,
    date: new Date().toISOString()
  };
  
  try {
    const res = await apiFetch(`${API_BASE}/purchases`, {
      method: 'POST',
      body: JSON.stringify(purchaseData)
    });
    
    if (res.ok) {
      // Clear form
      ['#purchase_sku','#purchase_name','#purchase_category','#purchase_quantity',
       '#purchase_unitCost','#purchase_totalCost','#purchase_supplier','#purchase_invoiceNo'].forEach(id => {
        if (qs(id)) qs(id).value = '';
      });
      await fetchPurchases();
      await fetchInventory(); // Refresh inventory to update quantities
      alert('✅ Purchase added successfully!');
    } else {
      const error = await res.json();
      alert('❌ Failed to add purchase: ' + (error.message || 'Unknown error'));
    }
  } catch (e) {
    console.error('Purchase error:', e);
    alert('❌ Server connection error while adding purchase.');
  }
}

async function deletePurchase(id) {
  const purchase = purchases.find(p => String(p.id) === String(id));
  if (!purchase) return;
  
  if (!confirm(`Confirm Delete Purchase: ${purchase.productName} from ${purchase.supplier}?`)) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/purchases/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await fetchPurchases();
      await fetchInventory(); // Refresh inventory
      alert('🗑️ Purchase deleted!');
    } else {
      alert('❌ Failed to delete purchase.');
    }
  } catch (e) {
    console.error('Delete purchase error:', e);
    alert('❌ Server connection error while deleting purchase.');
  }
}

async function addSale() {
  const sku = qs('#sales_sku')?.value?.trim();
  const productName = qs('#sales_name')?.value?.trim();
  const category = qs('#sales_category')?.value?.trim();
  const availableQty = Number(qs('#sales_availableQty')?.value || 0);
  const quantity = Number(qs('#sales_quantity')?.value || 0);
  const unitPrice = Number(qs('#sales_unitPrice')?.value || 0);
  const customer = qs('#sales_customer')?.value?.trim();
  const invoiceNo = qs('#sales_invoiceNo')?.value?.trim();
  
  if (!sku || !productName || !quantity || !unitPrice || !customer) {
    return alert('⚠️ Please fill in all required fields (SKU, Product, Quantity, Unit Price, Customer).');
  }
  
  if (quantity > availableQty) {
    return alert(`❌ Insufficient stock! Available: ${availableQty}, Requested: ${quantity}`);
  }
  
  if (!confirm(`Confirm Sale: ${quantity} x ${productName} to ${customer} for RM ${(quantity * unitPrice).toFixed(2)}?`)) return;
  
  const saleData = {
    sku,
    productName,
    category,
    quantity,
    unitPrice,
    customer,
    invoiceNo,
    date: new Date().toISOString()
  };
  
  try {
    const res = await apiFetch(`${API_BASE}/sales`, {
      method: 'POST',
      body: JSON.stringify(saleData)
    });
    
    if (res.ok) {
      // Clear form
      ['#sales_sku','#sales_name','#sales_category','#sales_availableQty','#sales_quantity',
       '#sales_unitPrice','#sales_totalPrice','#sales_customer','#sales_invoiceNo'].forEach(id => {
        if (qs(id)) qs(id).value = '';
      });
      await fetchSales();
      await fetchInventory(); // Refresh inventory to update quantities
      alert('✅ Sale added successfully!');
    } else {
      const error = await res.json();
      alert('❌ Failed to add sale: ' + (error.message || 'Unknown error'));
    }
  } catch (e) {
    console.error('Sale error:', e);
    alert('❌ Server connection error while adding sale.');
  }
}

async function deleteSale(id) {
  const sale = sales.find(s => String(s.id) === String(id));
  if (!sale) return;
  
  if (!confirm(`Confirm Delete Sale: ${sale.productName} to ${sale.customer}?`)) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/sales/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await fetchSales();
      await fetchInventory(); // Refresh inventory
      alert('🗑️ Sale deleted!');
    } else {
      alert('❌ Failed to delete sale.');
    }
  } catch (e) {
    console.error('Delete sale error:', e);
    alert('❌ Server connection error while deleting sale.');
  }
}

// =========================================
// NEW: Purchase & Sales Search Functions
// =========================================
function searchProductsForPurchase() {
  const query = qs('#purchase_search')?.value?.toLowerCase().trim();
  const resultsDiv = qs('#product_search_results');
  if (!resultsDiv) return;
  
  resultsDiv.innerHTML = '';
  resultsDiv.style.display = 'none';
  
  if (!query || query.length < 2) return;
  
  const filtered = inventory.filter(item => 
    (item.name?.toLowerCase().includes(query) || 
     item.sku?.toLowerCase().includes(query)) &&
    item.quantity !== undefined
  );
  
  if (filtered.length > 0) {
    resultsDiv.style.display = 'block';
    filtered.forEach(item => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.textContent = `${item.sku} - ${item.name} (Stock: ${item.quantity})`;
      div.onclick = () => selectProductForPurchase(item);
      resultsDiv.appendChild(div);
    });
  }
}

function selectProductForPurchase(item) {
  qs('#purchase_sku').value = item.sku || '';
  qs('#purchase_name').value = item.name || '';
  qs('#purchase_category').value = item.category || '';
  qs('#purchase_unitCost').value = item.unitCost || '0';
  qs('#purchase_search').value = '';
  qs('#product_search_results').innerHTML = '';
  qs('#product_search_results').style.display = 'none';
  qs('#purchase_quantity').focus();
}

function calculatePurchaseTotal() {
  const quantity = Number(qs('#purchase_quantity')?.value || 0);
  const unitCost = Number(qs('#purchase_unitCost')?.value || 0);
  const totalCost = quantity * unitCost;
  if (qs('#purchase_totalCost')) {
    qs('#purchase_totalCost').value = totalCost.toFixed(2);
  }
}

function searchProductsForSales() {
  const query = qs('#sales_search')?.value?.toLowerCase().trim();
  const resultsDiv = qs('#sales_search_results');
  if (!resultsDiv) return;
  
  resultsDiv.innerHTML = '';
  resultsDiv.style.display = 'none';
  
  if (!query || query.length < 2) return;
  
  const filtered = inventory.filter(item => 
    (item.name?.toLowerCase().includes(query) || 
     item.sku?.toLowerCase().includes(query)) &&
    item.quantity !== undefined &&
    item.quantity > 0 // Only show products with stock
  );
  
  if (filtered.length > 0) {
    resultsDiv.style.display = 'block';
    filtered.forEach(item => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.textContent = `${item.sku} - ${item.name} (Stock: ${item.quantity})`;
      div.onclick = () => selectProductForSale(item);
      resultsDiv.appendChild(div);
    });
  }
}

function selectProductForSale(item) {
  qs('#sales_sku').value = item.sku || '';
  qs('#sales_name').value = item.name || '';
  qs('#sales_category').value = item.category || '';
  qs('#sales_availableQty').value = item.quantity || '0';
  qs('#sales_unitPrice').value = item.unitPrice || '0';
  qs('#sales_search').value = '';
  qs('#sales_search_results').innerHTML = '';
  qs('#sales_search_results').style.display = 'none';
  qs('#sales_quantity').focus();
}

function calculateSalesTotal() {
  const quantity = Number(qs('#sales_quantity')?.value || 0);
  const unitPrice = Number(qs('#sales_unitPrice')?.value || 0);
  const totalPrice = quantity * unitPrice;
  if (qs('#sales_totalPrice')) {
    qs('#sales_totalPrice').value = totalPrice.toFixed(2);
  }
}

// =========================================
// NEW: Purchase & Sales Filter Functions
// =========================================
function applyPurchaseDateFilter() {
  const startDate = qs('#purchaseStartDate')?.value;
  const endDate = qs('#purchaseEndDate')?.value;
  filterPurchasesByDate(startDate, endDate);
}

function clearPurchaseDateFilter() {
  if (qs('#purchaseStartDate')) qs('#purchaseStartDate').value = '';
  if (qs('#purchaseEndDate')) qs('#purchaseEndDate').value = '';
  renderPurchases(purchases);
}

function applySalesDateFilter() {
  const startDate = qs('#salesStartDate')?.value;
  const endDate = qs('#salesEndDate')?.value;
  filterSalesByDate(startDate, endDate);
}

function clearSalesDateFilter() {
  if (qs('#salesStartDate')) qs('#salesStartDate').value = '';
  if (qs('#salesEndDate')) qs('#salesEndDate').value = '';
  renderSales(sales);
}

function filterPurchasesByDate(startDate, endDate) {
  if (!startDate && !endDate) {
    renderPurchases(purchases);
    return;
  }
  
  const filtered = purchases.filter(purchase => {
    const purchaseDate = new Date(purchase.date);
    
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      return purchaseDate >= start && purchaseDate <= end;
    } else if (startDate) {
      const start = new Date(startDate);
      return purchaseDate >= start;
    } else if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      return purchaseDate <= end;
    }
    return true;
  });
  
  renderPurchases(filtered);
}

function filterSalesByDate(startDate, endDate) {
  if (!startDate && !endDate) {
    renderSales(sales);
    return;
  }
  
  const filtered = sales.filter(sale => {
    const saleDate = new Date(sale.date);
    
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      return saleDate >= start && saleDate <= end;
    } else if (startDate) {
      const start = new Date(startDate);
      return saleDate >= start;
    } else if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      return saleDate <= end;
    }
    return true;
  });
  
  renderSales(filtered);
}

function searchPurchases() {
  const query = (qs('#purchaseSearchInput')?.value || '').toLowerCase().trim();
  const filtered = purchases.filter(purchase => 
    (purchase.supplier?.toLowerCase().includes(query) ||
     purchase.invoiceNo?.toLowerCase().includes(query) ||
     purchase.productName?.toLowerCase().includes(query) ||
     purchase.sku?.toLowerCase().includes(query))
  );
  renderPurchases(filtered);
}

function searchSales() {
  const query = (qs('#salesSearchInput')?.value || '').toLowerCase().trim();
  const filtered = sales.filter(sale => 
    (sale.customer?.toLowerCase().includes(query) ||
     sale.invoiceNo?.toLowerCase().includes(query) ||
     sale.productName?.toLowerCase().includes(query) ||
     sale.sku?.toLowerCase().includes(query))
  );
  renderSales(filtered);
}

function clearPurchaseSearch() {
  if (qs('#purchaseSearchInput')) qs('#purchaseSearchInput').value = '';
  renderPurchases(purchases);
}

function clearSalesSearch() {
  if (qs('#salesSearchInput')) qs('#salesSearchInput').value = '';
  renderSales(sales);
}

// =========================================
// NEW: Transaction History Functions
// =========================================
function showPurchaseHistoryModal() {
  const modal = qs('#purchaseHistoryModal');
  if (modal) {
    modal.style.display = 'block';
    loadPurchaseTransactionHistory();
  }
}

function showSalesHistoryModal() {
  const modal = qs('#salesHistoryModal');
  if (modal) {
    modal.style.display = 'block';
    loadSalesTransactionHistory();
  }
}

async function loadPurchaseTransactionHistory() {
  const monthFilter = qs('#purchaseMonthFilter')?.value;
  let filteredPurchases = purchases;
  
  if (monthFilter) {
    const [year, month] = monthFilter.split('-');
    filteredPurchases = purchases.filter(p => {
      const purchaseDate = new Date(p.date);
      return purchaseDate.getFullYear() == year && 
             purchaseDate.getMonth() + 1 == month;
    });
  }
  
  // Group by date and supplier
  const transactions = {};
  filteredPurchases.forEach(purchase => {
    const date = new Date(purchase.date).toDateString();
    const key = `${date}_${purchase.supplier}`;
    if (!transactions[key]) {
      transactions[key] = {
        date: date,
        supplier: purchase.supplier,
        totalAmount: 0,
        itemsCount: 0
      };
    }
    transactions[key].totalAmount += purchase.quantity * purchase.unitCost;
    transactions[key].itemsCount += 1;
  });
  
  const transactionList = Object.values(transactions);
  renderPurchaseTransactions(transactionList);
}

function renderPurchaseTransactions(transactions) {
  const list = qs('#purchaseTransactionList');
  if (!list) return;
  list.innerHTML = '';
  
  let monthlyTotal = 0;
  
  transactions.forEach(transaction => {
    monthlyTotal += transaction.totalAmount;
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${transaction.date}</td>
      <td>${escapeHtml(transaction.supplier)}</td>
      <td class="money">RM ${transaction.totalAmount.toFixed(2)}</td>
      <td>${transaction.itemsCount}</td>
    `;
    list.appendChild(tr);
  });
  
  if (qs('#monthlyPurchaseTotal')) {
    qs('#monthlyPurchaseTotal').textContent = monthlyTotal.toFixed(2);
  }
}

async function loadSalesTransactionHistory() {
  const monthFilter = qs('#salesMonthFilter')?.value;
  let filteredSales = sales;
  
  if (monthFilter) {
    const [year, month] = monthFilter.split('-');
    filteredSales = sales.filter(s => {
      const saleDate = new Date(s.date);
      return saleDate.getFullYear() == year && 
             saleDate.getMonth() + 1 == month;
    });
  }
  
  // Group by date and customer
  const transactions = {};
  filteredSales.forEach(sale => {
    const date = new Date(sale.date).toDateString();
    const key = `${date}_${sale.customer}`;
    const unitCost = Number(sale.unitCost || 0);
    const unitPrice = Number(sale.unitPrice || 0);
    const profit = (unitPrice - unitCost) * sale.quantity;
    
    if (!transactions[key]) {
      transactions[key] = {
        date: date,
        customer: sale.customer,
        totalRevenue: 0,
        totalProfit: 0,
        itemsCount: 0
      };
    }
    transactions[key].totalRevenue += sale.quantity * unitPrice;
    transactions[key].totalProfit += profit;
    transactions[key].itemsCount += 1;
  });
  
  const transactionList = Object.values(transactions);
  renderSalesTransactions(transactionList);
}

function renderSalesTransactions(transactions) {
  const list = qs('#salesTransactionList');
  if (!list) return;
  list.innerHTML = '';
  
  let monthlyRevenue = 0;
  let monthlyProfit = 0;
  
  transactions.forEach(transaction => {
    monthlyRevenue += transaction.totalRevenue;
    monthlyProfit += transaction.totalProfit;
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${transaction.date}</td>
      <td>${escapeHtml(transaction.customer)}</td>
      <td class="money">RM ${transaction.totalRevenue.toFixed(2)}</td>
      <td class="money">RM ${transaction.totalProfit.toFixed(2)}</td>
      <td>${transaction.itemsCount}</td>
    `;
    list.appendChild(tr);
  });
  
  if (qs('#monthlySalesRevenue')) {
    qs('#monthlySalesRevenue').textContent = monthlyRevenue.toFixed(2);
  }
  if (qs('#monthlySalesProfit')) {
    qs('#monthlySalesProfit').textContent = monthlyProfit.toFixed(2);
  }
}

// =========================================
// NEW: Company Information Functions
// =========================================
async function loadCompanyInformation() {
  try {
    const res = await apiFetch(`${API_BASE}/company`);
    if (res.ok) {
      const companyInfo = await res.json();
      if (companyInfo) {
        qs('#companyName').value = companyInfo.name || '';
        qs('#companyAddress').value = companyInfo.address || '';
        qs('#companyPhone').value = companyInfo.phone || '';
        qs('#companyEmail').value = companyInfo.email || '';
        qs('#companyTaxId').value = companyInfo.taxId || '';
      }
    }
  } catch (err) {
    console.error('Failed to load company information:', err);
  }
}

async function saveCompanyInformation() {
  const companyData = {
    name: qs('#companyName')?.value?.trim(),
    address: qs('#companyAddress')?.value?.trim(),
    phone: qs('#companyPhone')?.value?.trim(),
    email: qs('#companyEmail')?.value?.trim(),
    taxId: qs('#companyTaxId')?.value?.trim()
  };
  
  if (!companyData.name) {
    return alert('⚠️ Company name is required.');
  }
  
  try {
    const res = await apiFetch(`${API_BASE}/company`, {
      method: 'PUT',
      body: JSON.stringify(companyData)
    });
    
    const msgEl = qs('#companyInfoMessage');
    if (res.ok) {
      showMsg(msgEl, '✅ Company information saved successfully!', 'green');
    } else {
      const error = await res.json();
      showMsg(msgEl, `❌ Failed to save: ${error.message}`, 'red');
    }
  } catch (e) {
    console.error('Save company info error:', e);
    showMsg(qs('#companyInfoMessage'), '❌ Server connection failed.', 'red');
  }
}

// =========================================
// NEW: Report Generation Functions
// =========================================
async function generatePurchaseReport() {
  if(!confirm('Confirm Generate Purchase Report: This will create and save a new Excel file.')) return;
  try {
    const res = await apiFetch(`${API_BASE}/purchases/report`, { method: 'GET' });
    if(res.ok) {
      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition ? contentDisposition.match(/filename="(.+?)"/) : null;
      const filename = filenameMatch ? filenameMatch[1] : `Purchase_Report_${Date.now()}.xlsx`;
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
      alert(`Purchase Report "${filename}" successfully generated and saved to Documents!`);
    } else {
      try {
        const error = await res.json();
        alert(`Failed to generate purchase report: ${error.message}`);
      } catch(e) {
        alert('Failed to generate purchase report: Server did not return a valid message.');
      }
    }
  } catch(e) {
    console.error('Purchase report generation error:', e);
    alert('An error occurred during purchase report generation. Check console for details.');
  }
}

async function generatePurchaseInvoice() {
  if(!confirm("Generate PDF Purchase Invoice?")) return;

  try {
    const res = await apiFetch(`${API_BASE}/purchases/report/pdf`, { method: 'GET' });

    if(!res.ok) {
      try {
        const err = await res.json();
        alert(`Failed to generate purchase invoice: ${err.message || 'Server error'}`);
      } catch (_) {
        alert("Failed to generate purchase invoice.");
      }
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    const contentDisposition = res.headers.get('Content-Disposition');
    const filenameMatch = contentDisposition ? contentDisposition.match(/filename="(.+?)"/) : null;
    const filename = filenameMatch ? filenameMatch[1] : `Purchase_Invoice_${Date.now()}.pdf`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);
    await fetchDocuments();
    alert("PDF Purchase Invoice Generated Successfully!");
  } catch (e) {
    console.error(e);
    alert("PDF Purchase Invoice Generation Failed.");
  }
}

async function generateSalesReport() {
  if(!confirm('Confirm Generate Sales Report: This will create and save a new Excel file.')) return;
  try {
    const res = await apiFetch(`${API_BASE}/sales/report`, { method: 'GET' });
    if(res.ok) {
      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition ? contentDisposition.match(/filename="(.+?)"/) : null;
      const filename = filenameMatch ? filenameMatch[1] : `Sales_Report_${Date.now()}.xlsx`;
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
      alert(`Sales Report "${filename}" successfully generated and saved to Documents!`);
    } else {
      try {
        const error = await res.json();
        alert(`Failed to generate sales report: ${error.message}`);
      } catch(e) {
        alert('Failed to generate sales report: Server did not return a valid message.');
      }
    }
  } catch(e) {
    console.error('Sales report generation error:', e);
    alert('An error occurred during sales report generation. Check console for details.');
  }
}

async function generateSalesInvoice() {
  if(!confirm("Generate PDF Sales Invoice?")) return;

  try {
    const res = await apiFetch(`${API_BASE}/sales/report/pdf`, { method: 'GET' });

    if(!res.ok) {
      try {
        const err = await res.json();
        alert(`Failed to generate sales invoice: ${err.message || 'Server error'}`);
      } catch (_) {
        alert("Failed to generate sales invoice.");
      }
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    const contentDisposition = res.headers.get('Content-Disposition');
    const filenameMatch = contentDisposition ? contentDisposition.match(/filename="(.+?)"/) : null;
    const filename = filenameMatch ? filenameMatch[1] : `Sales_Invoice_${Date.now()}.pdf`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);
    await fetchDocuments();
    alert("PDF Sales Invoice Generated Successfully!");
  } catch (e) {
    console.error(e);
    alert("PDF Sales Invoice Generation Failed.");
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
    
    // NEW: Purchase and Sales pages
    if(currentPage.includes('purchase')) { 
      await fetchInventory();
      await fetchPurchases(); 
      bindPurchaseUI(); 
    }
    if(currentPage.includes('sales')) { 
      await fetchInventory();
      await fetchSales(); 
      bindSalesUI(); 
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

// =========================================
// NEW: Purchase & Sales UI Binding
// =========================================
function bindPurchaseUI(){
  qs('#addPurchaseBtn')?.addEventListener('click', addPurchase);
  qs('#purchaseReportBtn')?.addEventListener('click', generatePurchaseReport);
  qs('#purchaseInvoiceBtn')?.addEventListener('click', generatePurchaseInvoice);
  qs('#purchaseHistoryBtn')?.addEventListener('click', showPurchaseHistoryModal);
  
  // Search product functionality
  qs('#purchase_search')?.addEventListener('input', searchProductsForPurchase);
  qs('#purchase_quantity')?.addEventListener('input', calculatePurchaseTotal);
  qs('#purchase_unitCost')?.addEventListener('input', calculatePurchaseTotal);
  
  // Date range and search
  qs('#applyPurchaseDateRangeBtn')?.addEventListener('click', applyPurchaseDateFilter);
  qs('#clearPurchaseDateRangeBtn')?.addEventListener('click', clearPurchaseDateFilter);
  qs('#purchaseSearchInput')?.addEventListener('input', searchPurchases);
  qs('#clearPurchaseSearchBtn')?.addEventListener('click', clearPurchaseSearch);
}

function bindSalesUI(){
  qs('#addSalesBtn')?.addEventListener('click', addSale);
  qs('#salesReportBtn')?.addEventListener('click', generateSalesReport);
  qs('#salesInvoiceBtn')?.addEventListener('click', generateSalesInvoice);
  qs('#salesHistoryBtn')?.addEventListener('click', showSalesHistoryModal);
  
  // Search product functionality
  qs('#sales_search')?.addEventListener('input', searchProductsForSales);
  qs('#sales_quantity')?.addEventListener('input', calculateSalesTotal);
  qs('#sales_unitPrice')?.addEventListener('input', calculateSalesTotal);
  
  // Date range and search
  qs('#applySalesDateRangeBtn')?.addEventListener('click', applySalesDateFilter);
  qs('#clearSalesDateRangeBtn')?.addEventListener('click', clearSalesDateFilter);
  qs('#salesSearchInput')?.addEventListener('input', searchSales);
  qs('#clearSalesSearchBtn')?.addEventListener('click', clearSalesSearch);
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

  // Bind company information save button
  qs('#saveCompanyInfoBtn')?.addEventListener('click', saveCompanyInformation);
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

  // Modal close handlers
  qs('#purchaseHistoryModal .close')?.addEventListener('click', () => {
    qs('#purchaseHistoryModal').style.display = 'none';
  });
  
  qs('#salesHistoryModal .close')?.addEventListener('click', () => {
    qs('#salesHistoryModal').style.display = 'none';
  });
  
  // Close modals when clicking outside
  window.addEventListener('click', (event) => {
    const purchaseModal = qs('#purchaseHistoryModal');
    const salesModal = qs('#salesHistoryModal');
    
    if (event.target === purchaseModal) {
      purchaseModal.style.display = 'none';
    }
    if (event.target === salesModal) {
      salesModal.style.display = 'none';
    }
  });
});

// Expose functions for inline onclick handlers
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;
window.verifyDocument = verifyDocument;
window.cleanupCorruptedDocuments = cleanupCorruptedDocuments;

// NEW: Expose purchase and sales functions
window.addPurchase = addPurchase;
window.deletePurchase = deletePurchase;
window.addSale = addSale;
window.deleteSale = deleteSale;
window.loadPurchaseTransactionHistory = loadPurchaseTransactionHistory;
window.loadSalesTransactionHistory = loadSalesTransactionHistory;
window.showPurchaseHistoryModal = showPurchaseHistoryModal;
window.showSalesHistoryModal = showSalesHistoryModal;
window.saveCompanyInformation = saveCompanyInformation;
window.loadCompanyInformation = loadCompanyInformation;

// NEW: Expose search and filter functions
window.searchProductsForPurchase = searchProductsForPurchase;
window.selectProductForPurchase = selectProductForPurchase;
window.calculatePurchaseTotal = calculatePurchaseTotal;
window.searchProductsForSales = searchProductsForSales;
window.selectProductForSale = selectProductForSale;
window.calculateSalesTotal = calculateSalesTotal;
window.applyPurchaseDateFilter = applyPurchaseDateFilter;
window.clearPurchaseDateFilter = clearPurchaseDateFilter;
window.applySalesDateFilter = applySalesDateFilter;
window.clearSalesDateFilter = clearSalesDateFilter;
window.searchPurchases = searchPurchases;
window.searchSales = searchSales;
window.clearPurchaseSearch = clearPurchaseSearch;
window.clearSalesSearch = clearSalesSearch;

// NEW: Expose report generation functions
window.generatePurchaseReport = generatePurchaseReport;
window.generatePurchaseInvoice = generatePurchaseInvoice;
window.generateSalesReport = generateSalesReport;
window.generateSalesInvoice = generateSalesInvoice;

// Make fetch functions available globally
window.fetchInventory = fetchInventory;
window.fetchPurchases = fetchPurchases;
window.fetchSales = fetchSales;
