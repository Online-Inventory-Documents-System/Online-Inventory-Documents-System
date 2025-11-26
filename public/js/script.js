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

// NEW: Fetch purchases and sales
async function fetchPurchases() {
  try {
    const res = await apiFetch(`${API_BASE}/purchases`);
    if(!res.ok) throw new Error('Failed to fetch purchases');
    const data = await res.json();
    purchases = data.map(p => ({ ...p, id: p.id || p._id }));
    if (typeof renderPurchases === 'function') renderPurchases(purchases);
  } catch(err) { console.error(err); }
}

async function fetchSales() {
  try {
    const res = await apiFetch(`${API_BASE}/sales`);
    if(!res.ok) throw new Error('Failed to fetch sales');
    const data = await res.json();
    sales = data.map(s => ({ ...s, id: s.id || s._id }));
    if (typeof renderSales === 'function') renderSales(sales);
  } catch(err) { console.error(err); }
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
    if(currentPage.includes('purchase-management')) { 
      await fetchPurchases(); 
      bindPurchaseManagementUI();
    }
    if(currentPage.includes('sales-management')) { 
      await fetchSales(); 
      bindSalesManagementUI();
    }
    if(currentPage.includes('log') || currentPage === '' || currentPage === 'index.html') { 
      await fetchLogs(); 
      await fetchInventory(); 
    }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
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

// ============================================================================
//                    UPDATED: SIMPLIFIED PURCHASE AND SALE FUNCTIONS
// ============================================================================

// Purchase Functions - UPDATED: Simplified names and removed bulk prefix
function loadProductsIntoPurchaseDropdown(selectElement) {
  // Clear existing options except the first
  while (selectElement.options.length > 1) {
    selectElement.remove(1);
  }
  
  inventory.forEach(product => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.name} (${product.sku}) - Stock: ${product.quantity}`;
    selectElement.appendChild(option);
  });
}

function loadProductsForPurchase() {
  // Load products into all existing dropdowns
  document.querySelectorAll('#purchaseProducts .purchaseProduct').forEach(select => {
    loadProductsIntoPurchaseDropdown(select);
  });
  
  // Set today's date as default
  document.getElementById('purchaseDate').value = new Date().toISOString().split('T')[0];
  calculatePurchaseTotal();
}

function resetPurchaseForm() {
  document.getElementById('purchaseSupplier').value = '';
  document.getElementById('purchaseDate').value = new Date().toISOString().split('T')[0];
  
  // Reset to one row
  const container = document.getElementById('purchaseProducts');
  container.innerHTML = `
    <div class="product-row">
      <select class="purchaseProduct" required onchange="updatePurchasePrice(this)">
        <option value="">Select Product</option>
      </select>
      <input type="number" class="purchaseQuantity" min="1" placeholder="Qty" required oninput="calculatePurchaseTotal()">
      <input type="number" class="purchaseUnitCost" step="0.01" min="0" placeholder="Unit Cost" required oninput="calculatePurchaseTotal()">
      <span class="product-total">RM 0.00</span>
      <button type="button" class="danger-btn" onclick="removePurchaseRow(this)">Remove</button>
    </div>
  `;
  loadProductsForPurchase();
}

async function confirmPurchase() {
  const supplier = document.getElementById('purchaseSupplier').value;
  const date = document.getElementById('purchaseDate').value;

  if (!supplier) {
    alert('Please enter supplier');
    return;
  }

  const purchaseItems = [];
  let isValid = true;

  document.querySelectorAll('#purchaseProducts .product-row').forEach(row => {
    const productSelect = row.querySelector('.purchaseProduct');
    const quantityInput = row.querySelector('.purchaseQuantity');
    const unitCostInput = row.querySelector('.purchaseUnitCost');

    const productId = productSelect.value;
    const quantity = parseInt(quantityInput.value);
    const unitCost = parseFloat(unitCostInput.value);

    if (!productId || !quantity || !unitCost) {
      isValid = false;
      return;
    }

    purchaseItems.push({
      productId,
      quantityReceived: quantity,
      unitCost
    });
  });

  if (!isValid) {
    alert('Please fill in all product fields');
    return;
  }

  if (purchaseItems.length === 0) {
    alert('Please add at least one product');
    return;
  }

  if (!confirm(`Confirm purchase of ${purchaseItems.length} products from ${supplier}?`)) return;

  try {
    const res = await apiFetch(`${API_BASE}/purchases/bulk`, {
      method: 'POST',
      body: JSON.stringify({
        purchases: purchaseItems,
        supplier,
        date
      })
    });

    if (res.ok) {
      const data = await res.json();
      alert(`✅ Purchase completed! ${data.message}`);
      closePurchaseModal();
      await fetchInventory(); // Refresh inventory
    } else {
      const error = await res.json();
      alert(`❌ Failed to process purchase: ${error.message}`);
    }
  } catch (err) {
    console.error('Purchase error:', err);
    alert('❌ Server error while processing purchase');
  }
}

// Sale Functions - UPDATED: Simplified names and removed bulk prefix
function loadProductsIntoSaleDropdown(selectElement) {
  // Clear existing options except the first
  while (selectElement.options.length > 1) {
    selectElement.remove(1);
  }
  
  // Only show products with stock
  inventory.filter(product => product.quantity > 0).forEach(product => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.name} (${product.sku}) - Stock: ${product.quantity}`;
    selectElement.appendChild(option);
  });
}

function loadProductsForSale() {
  // Load products into all existing dropdowns
  document.querySelectorAll('#saleProducts .saleProduct').forEach(select => {
    loadProductsIntoSaleDropdown(select);
  });
  
  // Set today's date as default
  document.getElementById('saleDate').value = new Date().toISOString().split('T')[0];
  calculateSaleTotal();
}

function resetSaleForm() {
  document.getElementById('saleCustomer').value = '';
  document.getElementById('saleDate').value = new Date().toISOString().split('T')[0];
  
  // Reset to one row
  const container = document.getElementById('saleProducts');
  container.innerHTML = `
    <div class="product-row">
      <select class="saleProduct" required onchange="updateSalePrice(this)">
        <option value="">Select Product</option>
      </select>
      <input type="number" class="saleQuantity" min="1" placeholder="Qty" required oninput="calculateSaleTotal()">
      <input type="number" class="saleUnitPrice" step="0.01" min="0" placeholder="Unit Price" required oninput="calculateSaleTotal()">
      <span class="product-total">RM 0.00</span>
      <button type="button" class="danger-btn" onclick="removeSaleRow(this)">Remove</button>
    </div>
  `;
  loadProductsForSale();
}

async function confirmSale() {
  const customer = document.getElementById('saleCustomer').value;
  const date = document.getElementById('saleDate').value;

  if (!customer) {
    alert('Please enter customer');
    return;
  }

  const saleItems = [];
  let isValid = true;
  let hasStockIssues = false;
  let stockIssues = [];

  // First validate all items have sufficient stock
  document.querySelectorAll('#saleProducts .product-row').forEach(row => {
    const productSelect = row.querySelector('.saleProduct');
    const quantityInput = row.querySelector('.saleQuantity');
    const unitPriceInput = row.querySelector('.saleUnitPrice');

    const productId = productSelect.value;
    const quantity = parseInt(quantityInput.value);
    const unitPrice = parseFloat(unitPriceInput.value);

    if (!productId || !quantity || !unitPrice) {
      isValid = false;
      return;
    }

    // Check stock availability
    const product = inventory.find(p => p.id === productId);
    if (product && product.quantity < quantity) {
      hasStockIssues = true;
      stockIssues.push(`${product.name}: Available ${product.quantity}, Requested ${quantity}`);
    }

    saleItems.push({
      productId,
      quantitySold: quantity,
      unitPrice
    });
  });

  if (!isValid) {
    alert('Please fill in all product fields');
    return;
  }

  if (saleItems.length === 0) {
    alert('Please add at least one product');
    return;
  }

  if (hasStockIssues) {
    alert(`❌ Insufficient stock for:\n${stockIssues.join('\n')}`);
    return;
  }

  if (!confirm(`Confirm sale of ${saleItems.length} products to ${customer}?`)) return;

  try {
    const res = await apiFetch(`${API_BASE}/sales/bulk`, {
      method: 'POST',
      body: JSON.stringify({
        sales: saleItems,
        customer,
        date
      })
    });

    if (res.ok) {
      const data = await res.json();
      alert(`✅ Sale completed! ${data.message}`);
      closeSaleModal();
      await fetchInventory(); // Refresh inventory
    } else {
      const error = await res.json();
      alert(`❌ Failed to process sale: ${error.message}`);
    }
  } catch (err) {
    console.error('Sale error:', err);
    alert('❌ Server error while processing sale');
  }
}

// ============================================================================
//                    PURCHASE AND SALES MANAGEMENT FUNCTIONS
// ============================================================================

// Purchase Management Functions
function renderPurchases(purchasesList) {
  const list = qs('#purchasesList');
  if(!list) return;
  list.innerHTML = '';
  
  let totalQuantity = 0;
  let totalCost = 0;

  purchasesList.forEach(p => {
    const id = p.id || p._id;
    const quantity = p.quantityReceived || 0;
    const unitCost = p.unitCost || 0;
    const total = p.totalCost || 0;
    
    totalQuantity += quantity;
    totalCost += total;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(p.date).toLocaleDateString()}</td>
      <td>${escapeHtml(p.productName || '')}</td>
      <td>${escapeHtml(p.sku || '')}</td>
      <td>${escapeHtml(p.supplier || '')}</td>
      <td>${quantity}</td>
      <td class="money">RM ${unitCost.toFixed(2)}</td>
      <td class="money">RM ${total.toFixed(2)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditPurchasePage('${id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="confirmAndDeletePurchase('${id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });

  if(qs('#purchaseTotalQuantity')) qs('#purchaseTotalQuantity').textContent = totalQuantity;
  if(qs('#purchaseTotalCost')) qs('#purchaseTotalCost').textContent = totalCost.toFixed(2);
}

async function confirmAndDeletePurchase(id) {
  const purchase = purchases.find(x => String(x.id) === String(id));
  if(!purchase) return;
  if(!confirm(`Confirm Delete Purchase: "${purchase.productName}" (${purchase.quantityReceived} units)?`)) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/purchases/${id}`, { method: 'DELETE' });
    if(res.status === 204) {
      await fetchPurchases();
      await fetchInventory(); // Refresh inventory as well
      alert('🗑️ Purchase deleted!');
    } else {
      alert('❌ Failed to delete purchase.');
    }
  } catch(e) { 
    console.error(e); 
    alert('❌ Server connection error while deleting purchase.'); 
  }
}

// Sales Management Functions
function renderSales(salesList) {
  const list = qs('#salesList');
  if(!list) return;
  list.innerHTML = '';
  
  let totalQuantity = 0;
  let totalRevenue = 0;

  salesList.forEach(s => {
    const id = s.id || s._id;
    const quantity = s.quantitySold || 0;
    const unitPrice = s.unitPrice || 0;
    const total = s.totalRevenue || 0;
    
    totalQuantity += quantity;
    totalRevenue += total;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(s.date).toLocaleDateString()}</td>
      <td>${escapeHtml(s.productName || '')}</td>
      <td>${escapeHtml(s.sku || '')}</td>
      <td>${escapeHtml(s.customer || '')}</td>
      <td>${quantity}</td>
      <td class="money">RM ${unitPrice.toFixed(2)}</td>
      <td class="money">RM ${total.toFixed(2)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditSalePage('${id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="confirmAndDeleteSale('${id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });

  if(qs('#saleTotalQuantity')) qs('#saleTotalQuantity').textContent = totalQuantity;
  if(qs('#saleTotalRevenue')) qs('#saleTotalRevenue').textContent = totalRevenue.toFixed(2);
}

async function confirmAndDeleteSale(id) {
  const sale = sales.find(x => String(x.id) === String(id));
  if(!sale) return;
  if(!confirm(`Confirm Delete Sale: "${sale.productName}" (${sale.quantitySold} units)?`)) return;
  
  try {
    const res = await apiFetch(`${API_BASE}/sales/${id}`, { method: 'DELETE' });
    if(res.status === 204) {
      await fetchSales();
      await fetchInventory(); // Refresh inventory as well
      alert('🗑️ Sale deleted!');
    } else {
      alert('❌ Failed to delete sale.');
    }
  } catch(e) { 
    console.error(e); 
    alert('❌ Server connection error while deleting sale.'); 
  }
}

// Report Generation Functions
async function generateSelectedReport() {
  if (!selectedReportType) {
    alert('Please select a report type');
    return;
  }

  if (!confirm(`Generate ${selectedReportType} report?`)) return;

  try {
    let url;
    switch (selectedReportType) {
      case 'inventory':
        url = `${API_BASE}/inventory/report/pdf`;
        break;
      case 'purchase':
        url = `${API_BASE}/purchases/report/pdf`;
        break;
      case 'sales':
        url = `${API_BASE}/sales/report/pdf`;
        break;
      default:
        alert('Invalid report type');
        return;
    }

    const res = await apiFetch(url, { method: 'GET' });

    if (!res.ok) {
      let errorMessage = 'Report generation failed';
      try {
        const errorData = await res.json();
        errorMessage = errorData.message || errorMessage;
      } catch (e) {
        errorMessage = `Server error: ${res.status}`;
      }
      throw new Error(errorMessage);
    }

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    
    // Get filename from content disposition
    const contentDisposition = res.headers.get('Content-Disposition');
    let filename = `${selectedReportType}_report.pdf`;
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="(.+?)"/);
      if (filenameMatch) filename = filenameMatch[1];
    }
    
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);

    closeReportSelectionModal();
    await fetchDocuments(); // Refresh documents list
    alert(`✅ ${selectedReportType.charAt(0).toUpperCase() + selectedReportType.slice(1)} Report generated successfully!`);

  } catch (err) {
    console.error('Report generation error:', err);
    alert(`❌ Failed to generate ${selectedReportType} report: ${err.message}`);
  }
}

// Company Information Functions
async function loadCompanyInformation() {
  try {
    const res = await apiFetch(`${API_BASE}/company`);
    if (res.ok) {
      const company = await res.json();
      document.getElementById('companyName').value = company.name || '';
      document.getElementById('companyAddress').value = company.address || '';
      document.getElementById('companyPhone').value = company.phone || '';
      document.getElementById('companyEmail').value = company.email || '';
    }
  } catch (err) {
    console.error('Error loading company information:', err);
  }
}

async function saveCompanyInformation() {
  const name = document.getElementById('companyName').value.trim();
  const address = document.getElementById('companyAddress').value.trim();
  const phone = document.getElementById('companyPhone').value.trim();
  const email = document.getElementById('companyEmail').value.trim();
  const msgEl = document.getElementById('companyMessage');

  if (!name || !address || !phone || !email) {
    showMsg(msgEl, 'Please fill in all company information fields', 'red');
    return;
  }

  if (!confirm('Update company information?')) return;

  try {
    const res = await apiFetch(`${API_BASE}/company`, {
      method: 'PUT',
      body: JSON.stringify({ name, address, phone, email })
    });

    if (res.ok) {
      showMsg(msgEl, '✅ Company information updated successfully!', 'green');
      setTimeout(() => showMsg(msgEl, '', 'green'), 3000);
    } else {
      const error = await res.json();
      showMsg(msgEl, `❌ Failed to update: ${error.message}`, 'red');
    }
  } catch (err) {
    console.error('Company update error:', err);
    showMsg(msgEl, '❌ Server error while updating company information', 'red');
  }
}

// Password change function for settings page
async function changePassword() {
  const newPass = document.getElementById('newPassword')?.value;
  const confPass = document.getElementById('confirmPassword')?.value;
  const code = document.getElementById('securityCode')?.value;
  const msgEl = document.getElementById('passwordMessage');
  showMsg(msgEl, '');
  
  if(!newPass || !confPass || !code) { 
    return showMsg(msgEl, '⚠️ Please fill in all fields.', 'red'); 
  }
  
  if(newPass !== confPass) { 
    return showMsg(msgEl, '⚠️ New password and confirmation do not match.', 'red'); 
  }
  
  if(!confirm('Confirm Password Change? You will be logged out after a successful update.')) return;

  try {
    const res = await apiFetch(`${API_BASE}/account/password`, { 
      method: 'PUT', 
      body: JSON.stringify({ 
        username: getUsername(), 
        newPassword: newPass, 
        securityCode: code 
      }) 
    });
    
    const data = await res.json();
    
    if(res.ok) {
      showMsg(msgEl, '✅ Password updated successfully! Please log in again.', 'green');
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
      document.getElementById('securityCode').value = '';
      setTimeout(logout, 1500);
    } else {
      showMsg(msgEl, `❌ ${data.message || 'Failed to change password.'}`, 'red');
    }
  } catch(e) { 
    showMsg(msgEl, '❌ Server connection failed during password change.', 'red'); 
  }
}

// Delete account function for settings page
async function deleteAccount() {
  const code = document.getElementById('deleteSecurityCode')?.value;
  
  if(!code) {
    alert('Please enter security code to confirm deletion');
    return;
  }
  
  if(!confirm(`⚠️ WARNING: Are you absolutely sure you want to delete the account for "${getUsername()}"? This action cannot be undone.`)) return;

  try {
    const res = await apiFetch(`${API_BASE}/account`, { 
      method: 'DELETE', 
      body: JSON.stringify({ 
        username: getUsername(), 
        securityCode: code 
      }) 
    });
    
    const data = await res.json();
    
    if(res.ok) { 
      alert('🗑️ Account deleted successfully. You will now be logged out.'); 
      logout(); 
    } else {
      alert(`❌ ${data.message || 'Failed to delete account.'}`);
    }
  } catch(e) { 
    alert('❌ Server connection failed during account deletion.'); 
  }
}

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  // UPDATED: Removed single purchase/sale button bindings, kept bulk ones with simplified names
  qs('#bulkPurchaseBtn')?.addEventListener('click', openPurchaseModal);
  qs('#bulkSaleBtn')?.addEventListener('click', openSaleModal);
  qs('#reportSelectionBtn')?.addEventListener('click', openReportSelectionModal);
  qs('#searchInput')?.addEventListener('input', searchInventory);
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { 
    if(qs('#searchInput')) { 
      qs('#searchInput').value=''; 
      searchInventory(); 
    } 
  });
  
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

// Purchase Management (edit)
function openEditPurchasePage(id){ window.location.href = `purchase-edit.html?id=${encodeURIComponent(id)}`; }

// Sales Management (edit)
function openEditSalePage(id){ window.location.href = `sale-edit.html?id=${encodeURIComponent(id)}`; }

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

// Purchase Management UI
function bindPurchaseManagementUI() {
  qs('#searchPurchases')?.addEventListener('input', searchPurchases);
}

function searchPurchases() {
  const q = (qs('#searchPurchases')?.value || '').toLowerCase().trim();
  const filtered = purchases.filter(p => 
    (p.productName||'').toLowerCase().includes(q) || 
    (p.sku||'').toLowerCase().includes(q) ||
    (p.supplier||'').toLowerCase().includes(q) ||
    (p.date ? new Date(p.date).toLocaleDateString().toLowerCase() : '').includes(q)
  );
  renderPurchases(filtered);
}

// Sales Management UI
function bindSalesManagementUI() {
  qs('#searchSales')?.addEventListener('input', searchSales);
}

function searchSales() {
  const q = (qs('#searchSales')?.value || '').toLowerCase().trim();
  const filtered = sales.filter(s => 
    (s.productName||'').toLowerCase().includes(q) || 
    (s.sku||'').toLowerCase().includes(q) ||
    (s.customer||'').toLowerCase().includes(q) ||
    (s.date ? new Date(s.date).toLocaleDateString().toLowerCase() : '').includes(q)
  );
  renderSales(filtered);
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

  // Load company information
  loadCompanyInformation();
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

// Expose functions for inline onclick handlers
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;
window.verifyDocument = verifyDocument;
window.cleanupCorruptedDocuments = cleanupCorruptedDocuments;

// New exposed functions - UPDATED: Simplified function names
window.openPurchaseModal = openPurchaseModal;
window.closePurchaseModal = closePurchaseModal;
window.openSaleModal = openSaleModal;
window.closeSaleModal = closeSaleModal;
window.openReportSelectionModal = openReportSelectionModal;
window.closeReportSelectionModal = closeReportSelectionModal;
window.selectReport = selectReport;
window.generateSelectedReport = generateSelectedReport;
window.confirmPurchase = confirmPurchase;
window.confirmSale = confirmSale;
window.addPurchaseRow = addPurchaseRow;
window.removePurchaseRow = removePurchaseRow;
window.updatePurchasePrice = updatePurchasePrice;
window.calculatePurchaseTotal = calculatePurchaseTotal;
window.addSaleRow = addSaleRow;
window.removeSaleRow = removeSaleRow;
window.updateSalePrice = updateSalePrice;
window.calculateSaleTotal = calculateSaleTotal;
window.loadCompanyInformation = loadCompanyInformation;
window.saveCompanyInformation = saveCompanyInformation;
window.changePassword = changePassword;
window.deleteAccount = deleteAccount;
window.confirmAndDeletePurchase = confirmAndDeletePurchase;
window.confirmAndDeleteSale = confirmAndDeleteSale;
