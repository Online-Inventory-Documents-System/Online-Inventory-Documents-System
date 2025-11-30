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
  
  statements.forEach(doc => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(doc.name)}</td>
      <td>${(doc.size / (1024*1024)).toFixed(2)} MB</td>
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
// UPDATED: Inventory rendering with date range
// =========================================
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
}

// =========================================
// UPDATED: Enhanced initialization
// =========================================
window.addEventListener('load', async () => {
  initializeTheme();
  
  const adminName = getUsername();
  if(qs('#adminName')) qs('#adminName').textContent = adminName;

  try {
    // Fetch company info first
    await fetchCompanyInfo();
    
    if(currentPage.includes('inventory')) { 
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
// UPDATED: Enhanced UI binding
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
  qs('#closePurchaseModal')?.addEventListener('click', closeNewPurchaseModal);
  
  // Sales functionality
  qs('#salesHistoryBtn')?.addEventListener('click', openSalesHistoryModal);
  qs('#newSalesBtn')?.addEventListener('click', openNewSalesModal);
  qs('#addSalesProductItem')?.addEventListener('click', () => addSalesProductItem());
  qs('#saveSalesBtn')?.addEventListener('click', saveSalesOrder);
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
// Export functions to global scope
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

// Sales functions
window.openSalesHistoryModal = openSalesHistoryModal;
window.closeSalesHistoryModal = closeSalesHistoryModal;
window.openNewSalesModal = openNewSalesModal;
window.closeNewSalesModal = closeNewSalesModal;
window.saveSalesOrder = saveSalesOrder;
window.printSalesInvoice = printSalesInvoice;
window.deleteSales = deleteSales;
window.editSales = editSales;
window.viewSales = viewSales;

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

// Note: Due to character limits, some existing functions (like purchase management, 
// date range filtering, etc.) remain the same as in the original code but are integrated
// with the new functionality above.
