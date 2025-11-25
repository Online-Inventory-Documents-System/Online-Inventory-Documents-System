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

    // Format the date
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

// Date Range Filtering Functions
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
      end.setHours(23, 59, 59, 999);
      return itemDate <= end;
    }
    
    // If both dates are provided, filter items within the range
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
//                    ENHANCED PURCHASE AND SALES MANAGEMENT
// ============================================================================

// Enhanced Purchase Functions
async function loadProductsForPurchase() {
  try {
    const select = document.getElementById('purchaseProduct');
    select.innerHTML = '<option value="">Select Product</option>';
    
    inventory.forEach(product => {
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = `${product.name} (${product.sku}) - Stock: ${product.quantity}`;
      option.setAttribute('data-cost', product.unitCost);
      select.appendChild(option);
    });
    
    // Set today's date as default
    document.getElementById('purchaseDate').value = new Date().toISOString().split('T')[0];
    
    // Auto-fill unit cost when product is selected
    select.addEventListener('change', function() {
      const selectedOption = this.options[this.selectedIndex];
      if (selectedOption.value) {
        document.getElementById('purchaseUnitCost').value = selectedOption.getAttribute('data-cost');
      }
    });
  } catch (err) {
    console.error('Error loading products for purchase:', err);
  }
}

function resetPurchaseForm() {
  document.getElementById('purchaseProduct').value = '';
  document.getElementById('purchaseQuantity').value = '';
  document.getElementById('purchaseUnitCost').value = '';
  document.getElementById('purchaseSupplier').value = '';
  document.getElementById('purchaseDate').value = new Date().toISOString().split('T')[0];
}

async function confirmBulkPurchase() {
  const date = document.getElementById('purchaseDate').value;

  if (window.purchaseItems.length === 0) {
    alert('Please add at least one item to purchase');
    return;
  }

  if (!confirm(`Confirm purchase of ${window.purchaseItems.length} items? Total cost: RM ${window.purchaseItems.reduce((sum, item) => sum + item.totalCost, 0).toFixed(2)}`)) return;

  try {
    const purchases = window.purchaseItems.map(item => ({
      productId: item.productId,
      quantityReceived: item.quantity,
      unitCost: item.unitCost,
      supplier: item.supplier,
      date: date
    }));

    const res = await apiFetch(`${API_BASE}/purchases/bulk`, {
      method: 'POST',
      body: JSON.stringify({ purchases })
    });

    if (res.ok) {
      alert(`✅ ${window.purchaseItems.length} purchase items recorded successfully!`);
      closePurchaseModal();
      await fetchInventory();
      window.purchaseItems = [];
    } else {
      const error = await res.json();
      alert(`❌ Failed to record purchases: ${error.message}`);
    }
  } catch (err) {
    console.error('Bulk purchase error:', err);
    alert('
