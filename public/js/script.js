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

// ============================================================================
//                               PURCHASE FUNCTIONS
// ============================================================================

// Fetch purchases
async function fetchPurchases() {
  try {
    const res = await apiFetch(`${API_BASE}/purchases`);
    if (!res.ok) throw new Error('Failed to fetch purchases');
    purchases = await res.json();
    return purchases;
  } catch (err) {
    console.error('Purchases fetch error:', err);
    return [];
  }
}

// Render purchases table
function renderPurchases(purchaseList) {
  const list = document.getElementById('purchaseList');
  if (!list) return;
  
  list.innerHTML = '';
  
  purchaseList.forEach(purchase => {
    const tr = document.createElement('tr');
    tr.className = 'transaction-item';
    
    const purchaseDate = new Date(purchase.purchaseDate || purchase.createdAt).toLocaleDateString();
    
    tr.innerHTML = `
      <td>${purchaseDate}</td>
      <td>${escapeHtml(purchase.sku || '')}</td>
      <td>${escapeHtml(purchase.productName || '')}</td>
      <td>${escapeHtml(purchase.supplier || 'N/A')}</td>
      <td>${purchase.quantity}</td>
      <td class="money">RM ${(purchase.unitCost || 0).toFixed(2)}</td>
      <td class="money">RM ${(purchase.totalCost || 0).toFixed(2)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="editPurchase('${purchase.id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="deletePurchase('${purchase.id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });
}

// Update purchase summary cards
function updatePurchaseSummary() {
  const totalPurchases = purchases.length;
  const totalQuantity = purchases.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const totalCost = purchases.reduce((sum, p) => sum + (p.totalCost || 0), 0);
  const averagePurchase = totalPurchases > 0 ? totalCost / totalPurchases : 0;

  if (qs('#cardTotalPurchases')) qs('#cardTotalPurchases').textContent = totalPurchases;
  if (qs('#cardTotalQuantity')) qs('#cardTotalQuantity').textContent = totalQuantity;
  if (qs('#cardTotalCost')) qs('#cardTotalCost').textContent = `RM ${totalCost.toFixed(2)}`;
  if (qs('#cardAveragePurchase')) qs('#cardAveragePurchase').textContent = `RM ${averagePurchase.toFixed(2)}`;
}

// Calculate total cost for purchase form
function calculateTotalCost() {
  const quantity = parseInt(qs('#purchaseQuantity')?.value) || 0;
  const unitCost = parseFloat(qs('#purchaseUnitCost')?.value) || 0;
  const totalCost = quantity * unitCost;
  
  if (qs('#totalCostDisplay')) {
    qs('#totalCostDisplay').textContent = `Total Cost: RM ${totalCost.toFixed(2)}`;
  }
}

// Add new purchase
async function addPurchase() {
  const productSelect = qs('#purchaseProduct');
  const productId = productSelect?.value;
  const quantity = parseInt(qs('#purchaseQuantity')?.value);
  const unitCost = parseFloat(qs('#purchaseUnitCost')?.value);
  const supplier = qs('#purchaseSupplier')?.value;
  const purchaseDate = qs('#purchaseDate')?.value;

  if (!productId || !quantity || !unitCost) {
    alert('⚠️ Please fill in all required fields (Product, Quantity, Unit Cost)');
    return;
  }

  if (quantity <= 0) {
    alert('⚠️ Quantity must be greater than 0');
    return;
  }

  if (unitCost <= 0) {
    alert('⚠️ Unit cost must be greater than 0');
    return;
  }

  const selectedOption = productSelect.options[productSelect.selectedIndex];
  if (!confirm(`Confirm Purchase:\nProduct: ${selectedOption.text}\nQuantity: ${quantity}\nUnit Cost: RM ${unitCost.toFixed(2)}\nTotal Cost: RM ${(quantity * unitCost).toFixed(2)}`)) {
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/purchases`, {
      method: 'POST',
      body: JSON.stringify({
        productId,
        quantity,
        unitCost,
        supplier,
        purchaseDate: purchaseDate || new Date().toISOString().split('T')[0]
      })
    });

    if (res.ok) {
      // Clear form
      if (qs('#purchaseQuantity')) qs('#purchaseQuantity').value = '1';
      if (qs('#purchaseSupplier')) qs('#purchaseSupplier').value = '';
      if (qs('#purchaseDate')) qs('#purchaseDate').value = '';
      calculateTotalCost();
      
      await fetchPurchases();
      await fetchInventory(); // Refresh inventory for updated stock
      alert('✅ Purchase added successfully!');
    } else {
      const error = await res.json();
      alert(`❌ Failed to add purchase: ${error.message}`);
    }
  } catch (err) {
    console.error('Purchase add error:', err);
    alert('❌ Server error while adding purchase');
  }
}

// Edit purchase
async function editPurchase(purchaseId) {
  const purchase = purchases.find(p => p.id === purchaseId);
  if (!purchase) return;

  const newQuantity = prompt('Enter new quantity:', purchase.quantity);
  if (newQuantity === null) return;

  const newUnitCost = prompt('Enter new unit cost:', purchase.unitCost);
  if (newUnitCost === null) return;

  const newSupplier = prompt('Enter new supplier:', purchase.supplier || '');

  if (!newQuantity || !newUnitCost || parseInt(newQuantity) <= 0 || parseFloat(newUnitCost) <= 0) {
    alert('⚠️ Invalid input. Quantity and unit cost must be positive numbers.');
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/purchases/${purchaseId}`, {
      method: 'PUT',
      body: JSON.stringify({
        quantity: parseInt(newQuantity),
        unitCost: parseFloat(newUnitCost),
        supplier: newSupplier,
        purchaseDate: purchase.purchaseDate
      })
    });

    if (res.ok) {
      await fetchPurchases();
      await fetchInventory();
      alert('✅ Purchase updated successfully!');
    } else {
      const error = await res.json();
      alert(`❌ Failed to update purchase: ${error.message}`);
    }
  } catch (err) {
    console.error('Purchase update error:', err);
    alert('❌ Server error while updating purchase');
  }
}

// Delete purchase
async function deletePurchase(purchaseId) {
  const purchase = purchases.find(p => p.id === purchaseId);
  if (!purchase) return;

  if (!confirm(`Confirm Delete Purchase:\n${purchase.productName}\nQuantity: ${purchase.quantity}\nTotal Cost: RM ${purchase.totalCost.toFixed(2)}`)) {
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/purchases/${purchaseId}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      await fetchPurchases();
      await fetchInventory();
      alert('🗑️ Purchase deleted successfully!');
    } else {
      const error = await res.json();
      alert(`❌ Failed to delete purchase: ${error.message}`);
    }
  } catch (err) {
    console.error('Purchase delete error:', err);
    alert('❌ Server error while deleting purchase');
  }
}

// Generate purchase PDF report
async function generatePurchasePDF() {
  if (!confirm('Generate Purchase PDF Report?')) return;

  try {
    const res = await apiFetch(`${API_BASE}/purchases/report/pdf`, { method: 'GET' });

    if (!res.ok) {
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
    const filename = filenameMatch ? filenameMatch[1] : `Purchase_Report_${Date.now()}.pdf`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);
    alert("Purchase PDF Report Generated Successfully!");
  } catch (e) {
    console.error(e);
    alert("Purchase PDF Generation Failed.");
  }
}

// View purchase history
function viewPurchaseHistory() {
  alert(`Purchase History:\nTotal Transactions: ${purchases.length}\nTotal Items: ${purchases.reduce((sum, p) => sum + p.quantity, 0)}\nTotal Spent: RM ${purchases.reduce((sum, p) => sum + p.totalCost, 0).toFixed(2)}`);
}

// Search purchases
function searchPurchases() {
  const searchText = (qs('#purchaseSearchInput')?.value || '').toLowerCase();
  const startDate = qs('#purchaseStartDate')?.value;
  const endDate = qs('#purchaseEndDate')?.value;

  let filtered = purchases;

  // Text search
  if (searchText) {
    filtered = filtered.filter(p => 
      (p.productName || '').toLowerCase().includes(searchText) ||
      (p.sku || '').toLowerCase().includes(searchText) ||
      (p.supplier || '').toLowerCase().includes(searchText)
    );
  }

  // Date range filter
  if (startDate || endDate) {
    filtered = filtered.filter(p => {
      const purchaseDate = new Date(p.purchaseDate || p.createdAt);
      
      if (startDate && !endDate) {
        return purchaseDate >= new Date(startDate);
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

  renderPurchases(filtered);
}

// Clear purchase search
function clearPurchaseSearch() {
  if (qs('#purchaseSearchInput')) qs('#purchaseSearchInput').value = '';
  if (qs('#purchaseStartDate')) qs('#purchaseStartDate').value = '';
  if (qs('#purchaseEndDate')) qs('#purchaseEndDate').value = '';
  renderPurchases(purchases);
}

// ============================================================================
//                               SALES FUNCTIONS
// ============================================================================

// Fetch sales
async function fetchSales() {
  try {
    const res = await apiFetch(`${API_BASE}/sales`);
    if (!res.ok) throw new Error('Failed to fetch sales');
    sales = await res.json();
    return sales;
  } catch (err) {
    console.error('Sales fetch error:', err);
    return [];
  }
}

// Render sales table
function renderSales(salesList) {
  const list = document.getElementById('salesList');
  if (!list) return;
  
  list.innerHTML = '';
  
  salesList.forEach(sale => {
    const tr = document.createElement('tr');
    tr.className = 'transaction-item';
    
    const saleDate = new Date(sale.saleDate || sale.createdAt).toLocaleDateString();
    
    tr.innerHTML = `
      <td>${saleDate}</td>
      <td>${escapeHtml(sale.sku || '')}</td>
      <td>${escapeHtml(sale.productName || '')}</td>
      <td>${escapeHtml(sale.customer || 'N/A')}</td>
      <td>${sale.quantity}</td>
      <td class="money">RM ${(sale.unitPrice || 0).toFixed(2)}</td>
      <td class="money">RM ${(sale.totalRevenue || 0).toFixed(2)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="editSale('${sale.id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="deleteSale('${sale.id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });
}

// Update sales summary cards
function updateSalesSummary() {
  const totalSales = sales.length;
  const totalSold = sales.reduce((sum, s) => sum + (s.quantity || 0), 0);
  const totalRevenue = sales.reduce((sum, s) => sum + (s.totalRevenue || 0), 0);
  const averageSale = totalSales > 0 ? totalRevenue / totalSales : 0;

  if (qs('#cardTotalSales')) qs('#cardTotalSales').textContent = totalSales;
  if (qs('#cardTotalSold')) qs('#cardTotalSold').textContent = totalSold;
  if (qs('#cardTotalRevenue')) qs('#cardTotalRevenue').textContent = `RM ${totalRevenue.toFixed(2)}`;
  if (qs('#cardAverageSale')) qs('#cardAverageSale').textContent = `RM ${averageSale.toFixed(2)}`;
}

// Calculate total revenue for sales form
function calculateTotalRevenue() {
  const quantity = parseInt(qs('#salesQuantity')?.value) || 0;
  const unitPrice = parseFloat(qs('#salesUnitPrice')?.value) || 0;
  const totalRevenue = quantity * unitPrice;
  
  if (qs('#totalRevenueDisplay')) {
    qs('#totalRevenueDisplay').textContent = `Total Revenue: RM ${totalRevenue.toFixed(2)}`;
  }
  
  // Check stock availability
  checkStockAvailability();
}

// Check stock availability for sales
function checkStockAvailability() {
  const productSelect = qs('#salesProduct');
  const quantityInput = qs('#salesQuantity');
  const warningElement = qs('#stockWarning');
  
  if (!productSelect?.value || !warningElement) {
    return;
  }
  
  const selectedOption = productSelect.options[productSelect.selectedIndex];
  const availableStock = parseInt(selectedOption.dataset.stock) || 0;
  const requestedQuantity = parseInt(quantityInput?.value) || 0;
  
  if (requestedQuantity > availableStock) {
    warningElement.textContent = `⚠️ Insufficient stock! Available: ${availableStock}`;
    warningElement.style.display = 'block';
  } else {
    warningElement.style.display = 'none';
  }
}

// Add new sale
async function addSale() {
  const productSelect = qs('#salesProduct');
  const productId = productSelect?.value;
  const quantity = parseInt(qs('#salesQuantity')?.value);
  const unitPrice = parseFloat(qs('#salesUnitPrice')?.value);
  const customer = qs('#salesCustomer')?.value;
  const saleDate = qs('#salesDate')?.value;

  if (!productId || !quantity || !unitPrice) {
    alert('⚠️ Please fill in all required fields (Product, Quantity, Unit Price)');
    return;
  }

  if (quantity <= 0) {
    alert('⚠️ Quantity must be greater than 0');
    return;
  }

  if (unitPrice <= 0) {
    alert('⚠️ Unit price must be greater than 0');
    return;
  }

  // Check stock availability
  const selectedOption = productSelect.options[productSelect.selectedIndex];
  const availableStock = parseInt(selectedOption.dataset.stock) || 0;
  if (quantity > availableStock) {
    alert(`❌ Insufficient stock! Available: ${availableStock}, Requested: ${quantity}`);
    return;
  }

  if (!confirm(`Confirm Sale:\nProduct: ${selectedOption.text}\nQuantity: ${quantity}\nUnit Price: RM ${unitPrice.toFixed(2)}\nTotal Revenue: RM ${(quantity * unitPrice).toFixed(2)}`)) {
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/sales`, {
      method: 'POST',
      body: JSON.stringify({
        productId,
        quantity,
        unitPrice,
        customer,
        saleDate: saleDate || new Date().toISOString().split('T')[0]
      })
    });

    if (res.ok) {
      // Clear form
      if (qs('#salesQuantity')) qs('#salesQuantity').value = '1';
      if (qs('#salesCustomer')) qs('#salesCustomer').value = '';
      if (qs('#salesDate')) qs('#salesDate').value = '';
      calculateTotalRevenue();
      
      await fetchSales();
      await fetchInventory(); // Refresh inventory for updated stock
      alert('✅ Sale added successfully!');
    } else {
      const error = await res.json();
      alert(`❌ Failed to add sale: ${error.message}`);
    }
  } catch (err) {
    console.error('Sale add error:', err);
    alert('❌ Server error while adding sale');
  }
}

// Edit sale
async function editSale(saleId) {
  const sale = sales.find(s => s.id === saleId);
  if (!sale) return;

  const newQuantity = prompt('Enter new quantity:', sale.quantity);
  if (newQuantity === null) return;

  const newUnitPrice = prompt('Enter new unit price:', sale.unitPrice);
  if (newUnitPrice === null) return;

  const newCustomer = prompt('Enter new customer:', sale.customer || '');

  if (!newQuantity || !newUnitPrice || parseInt(newQuantity) <= 0 || parseFloat(newUnitPrice) <= 0) {
    alert('⚠️ Invalid input. Quantity and unit price must be positive numbers.');
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/sales/${saleId}`, {
      method: 'PUT',
      body: JSON.stringify({
        quantity: parseInt(newQuantity),
        unitPrice: parseFloat(newUnitPrice),
        customer: newCustomer,
        saleDate: sale.saleDate
      })
    });

    if (res.ok) {
      await fetchSales();
      await fetchInventory();
      alert('✅ Sale updated successfully!');
    } else {
      const error = await res.json();
      alert(`❌ Failed to update sale: ${error.message}`);
    }
  } catch (err) {
    console.error('Sale update error:', err);
    alert('❌ Server error while updating sale');
  }
}

// Delete sale
async function deleteSale(saleId) {
  const sale = sales.find(s => s.id === saleId);
  if (!sale) return;

  if (!confirm(`Confirm Delete Sale:\n${sale.productName}\nQuantity: ${sale.quantity}\nTotal Revenue: RM ${sale.totalRevenue.toFixed(2)}`)) {
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/sales/${saleId}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      await fetchSales();
      await fetchInventory();
      alert('🗑️ Sale deleted successfully!');
    } else {
      const error = await res.json();
      alert(`❌ Failed to delete sale: ${error.message}`);
    }
  } catch (err) {
    console.error('Sale delete error:', err);
    alert('❌ Server error while deleting sale');
  }
}

// Generate sales PDF report
async function generateSalesPDF() {
  if (!confirm('Generate Sales PDF Report?')) return;

  try {
    const res = await apiFetch(`${API_BASE}/sales/report/pdf`, { method: 'GET' });

    if (!res.ok) {
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
    const filename = filenameMatch ? filenameMatch[1] : `Sales_Report_${Date.now()}.pdf`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);
    alert("Sales PDF Report Generated Successfully!");
  } catch (e) {
    console.error(e);
    alert("Sales PDF Generation Failed.");
  }
}

// View sales history
function viewSalesHistory() {
  alert(`Sales History:\nTotal Transactions: ${sales.length}\nTotal Items Sold: ${sales.reduce((sum, s) => sum + s.quantity, 0)}\nTotal Revenue: RM ${sales.reduce((sum, s) => sum + s.totalRevenue, 0).toFixed(2)}`);
}

// Search sales
function searchSales() {
  const searchText = (qs('#salesSearchInput')?.value || '').toLowerCase();
  const startDate = qs('#salesStartDate')?.value;
  const endDate = qs('#salesEndDate')?.value;

  let filtered = sales;

  // Text search
  if (searchText) {
    filtered = filtered.filter(s => 
      (s.productName || '').toLowerCase().includes(searchText) ||
      (s.sku || '').toLowerCase().includes(searchText) ||
      (s.customer || '').toLowerCase().includes(searchText)
    );
  }

  // Date range filter
  if (startDate || endDate) {
    filtered = filtered.filter(s => {
      const saleDate = new Date(s.saleDate || s.createdAt);
      
      if (startDate && !endDate) {
        return saleDate >= new Date(startDate);
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

  renderSales(filtered);
}

// Clear sales search
function clearSalesSearch() {
  if (qs('#salesSearchInput')) qs('#salesSearchInput').value = '';
  if (qs('#salesStartDate')) qs('#salesStartDate').value = '';
  if (qs('#salesEndDate')) qs('#salesEndDate').value = '';
  renderSales(sales);
}

// ============================================================================
//                               INITIALIZATION
// ============================================================================

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
    if(currentPage.includes('purchase')) await initPurchasePage();
    if(currentPage.includes('sales')) await initSalesPage();
  } catch(e) { console.error('Init error', e); }
});

// Initialize purchase page
async function initPurchasePage() {
  await fetchInventory();
  await fetchPurchases();
  bindPurchaseUI();
  updatePurchaseSummary();
}

// Initialize sales page
async function initSalesPage() {
  await fetchInventory();
  await fetchSales();
  bindSalesUI();
  updateSalesSummary();
}

// Populate product dropdown for purchase
function populatePurchaseProductDropdown() {
  const dropdown = qs('#purchaseProduct');
  if (!dropdown) return;
  
  dropdown.innerHTML = '<option value="">Select Product</option>';
  
  inventory.forEach(product => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.name} (${product.sku}) - Stock: ${product.quantity || 0}`;
    option.dataset.unitCost = product.unitCost || 0;
    dropdown.appendChild(option);
  });
}

// Populate product dropdown for sales
function populateSalesProductDropdown() {
  const dropdown = qs('#salesProduct');
  if (!dropdown) return;
  
  dropdown.innerHTML = '<option value="">Select Product</option>';
  
  inventory.forEach(product => {
    if ((product.quantity || 0) > 0) { // Only show products with stock
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = `${product.name} (${product.sku}) - Stock: ${product.quantity || 0}`;
      option.dataset.unitPrice = product.unitPrice || 0;
      option.dataset.stock = product.quantity || 0;
      dropdown.appendChild(option);
    }
  });
}

// Bind purchase UI events
function bindPurchaseUI() {
  qs('#addPurchaseBtn')?.addEventListener('click', addPurchase);
  qs('#purchaseReportBtn')?.addEventListener('click', generatePurchasePDF);
  qs('#purchaseHistoryBtn')?.addEventListener('click', viewPurchaseHistory);
  qs('#purchaseSearchInput')?.addEventListener('input', searchPurchases);
  qs('#clearPurchaseSearchBtn')?.addEventListener('click', clearPurchaseSearch);
  qs('#applyPurchaseDateRangeBtn')?.addEventListener('click', searchPurchases);
  qs('#clearPurchaseDateRangeBtn')?.addEventListener('click', clearPurchaseSearch);

  // Auto-calculate total cost
  qs('#purchaseQuantity')?.addEventListener('input', calculateTotalCost);
  qs('#purchaseUnitCost')?.addEventListener('input', calculateTotalCost);

  // Auto-fill unit cost when product is selected
  qs('#purchaseProduct')?.addEventListener('change', function() {
    const selectedOption = this.options[this.selectedIndex];
    if (selectedOption.value && selectedOption.dataset.unitCost) {
      qs('#purchaseUnitCost').value = selectedOption.dataset.unitCost;
      calculateTotalCost();
    }
  });

  // Set default date to today
  if (qs('#purchaseDate')) {
    qs('#purchaseDate').value = new Date().toISOString().split('T')[0];
  }
  
  // Populate product dropdown
  populatePurchaseProductDropdown();
}

// Bind sales UI events
function bindSalesUI() {
  qs('#addSalesBtn')?.addEventListener('click', addSale);
  qs('#salesReportBtn')?.addEventListener('click', generateSalesPDF);
  qs('#salesHistoryBtn')?.addEventListener('click', viewSalesHistory);
  qs('#salesSearchInput')?.addEventListener('input', searchSales);
  qs('#clearSalesSearchBtn')?.addEventListener('click', clearSalesSearch);
  qs('#applySalesDateRangeBtn')?.addEventListener('click', searchSales);
  qs('#clearSalesDateRangeBtn')?.addEventListener('click', clearSalesSearch);

  // Auto-calculate total revenue
  qs('#salesQuantity')?.addEventListener('input', calculateTotalRevenue);
  qs('#salesUnitPrice')?.addEventListener('input', calculateTotalRevenue);

  // Auto-fill unit price and check stock when product is selected
  qs('#salesProduct')?.addEventListener('change', function() {
    const selectedOption = this.options[this.selectedIndex];
    if (selectedOption.value && selectedOption.dataset.unitPrice) {
      qs('#salesUnitPrice').value = selectedOption.dataset.unitPrice;
      calculateTotalRevenue();
    }
    
    // Update stock info
    const stockInfo = qs('#stockInfo');
    if (selectedOption.value && stockInfo) {
      const stock = selectedOption.dataset.stock || 0;
      stockInfo.textContent = `Available stock: ${stock}`;
      stockInfo.style.color = stock > 10 ? 'green' : stock > 0 ? 'orange' : 'red';
    } else if (stockInfo) {
      stockInfo.textContent = '';
    }
  });

  // Set default date to today
  if (qs('#salesDate')) {
    qs('#salesDate').value = new Date().toISOString().split('T')[0];
  }
  
  // Populate product dropdown
  populateSalesProductDropdown();
}

// ============================================================================
//                               AUTH SYSTEM
// ============================================================================

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

// ============================================================================
//                               INVENTORY CRUD
// ============================================================================

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

// ============================================================================
//                               DOCUMENTS SYSTEM
// ============================================================================

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

// ============================================================================
//                               SETTINGS SYSTEM
// ============================================================================

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

// ============================================================================
//                               GLOBAL EXPORTS
// ============================================================================

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
window.editPurchase = editPurchase;
window.deletePurchase = deletePurchase;
window.editSale = editSale;
window.deleteSale = deleteSale;
