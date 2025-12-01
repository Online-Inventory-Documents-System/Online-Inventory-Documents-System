// public/js/script.js
// FINAL FULL VERSION
// Complete client-side script for Online Inventory & Documents System

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

// Utilities
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
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

// Theme
function initializeTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.body.classList.toggle('dark-mode', savedTheme === 'dark');
  document.body.setAttribute('data-theme', savedTheme);
}
function toggleTheme(){
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

// Fetch wrapper
async function apiFetch(url, options = {}) {
  options.headers = { 'Content-Type': 'application/json', 'X-Username': getUsername(), ...options.headers };
  return fetch(url, options);
}

// Auth
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  try { window.location.href = 'login.html'; } catch(e) {}
}
function logout(){
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('adminName');
  window.location.href = 'login.html';
}

// =========================================
// COMPANY INFO
// =========================================
async function fetchCompanyInfo() {
  try {
    const res = await apiFetch(`${API_BASE}/company`);
    if (res.ok) { companyInfo = await res.json(); updateCompanyInfoDisplay(); }
  } catch (err) { console.error(err); }
}
function updateCompanyInfoDisplay() {
  if (qs('#companyNameDisplay')) qs('#companyNameDisplay').textContent = companyInfo.name || 'L&B Company';
  if (qs('#companyAddressDisplay')) qs('#companyAddressDisplay').textContent = companyInfo.address || 'Melaka';
  if (qs('#companyPhoneDisplay')) qs('#companyPhoneDisplay').textContent = companyInfo.phone || '0123456789';
  if (qs('#companyEmailDisplay')) qs('#companyEmailDisplay').textContent = companyInfo.email || 'email@example.com';
}
async function updateCompanyInfo() {
  const name = qs('#companyName')?.value?.trim();
  const address = qs('#companyAddress')?.value?.trim();
  const phone = qs('#companyPhone')?.value?.trim();
  const email = qs('#companyEmail')?.value?.trim();
  if (!name || !address) return alert('Fill all fields');
  await apiFetch(`${API_BASE}/company`, { method: 'PUT', body: JSON.stringify({ name, address, phone, email }) });
  alert('Updated!');
  fetchCompanyInfo();
}

// =========================================
// INVENTORY
// =========================================
async function fetchInventory() {
  try {
    const res = await apiFetch(`${API_BASE}/inventory`);
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
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    totalValue += qty * uc;
    totalRevenue += qty * up;
    totalProfit += (qty * up) - (qty * uc);
    totalStock += qty;

    const tr = document.createElement('tr');
    if(qty === 0) tr.classList.add('out-of-stock-row');
    else if(qty < 10) tr.classList.add('low-stock-row');

    tr.innerHTML = `
      <td>${escapeHtml(it.sku)}</td><td>${escapeHtml(it.name)}</td><td>${escapeHtml(it.category)}</td>
      <td>${qty}</td><td class="money">RM ${uc.toFixed(2)}</td><td class="money">RM ${up.toFixed(2)}</td>
      <td class="money">RM ${(qty*uc).toFixed(2)}</td><td class="money">RM ${(qty*up).toFixed(2)}</td>
      <td class="money">RM ${((qty*up)-(qty*uc)).toFixed(2)}</td>
      <td>${new Date(it.createdAt).toLocaleDateString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditPageForItem('${it.id}')">✏️</button>
        <button class="danger-btn small-btn" onclick="confirmAndDeleteItem('${it.id}')">🗑️</button>
      </td>
    `;
    list.appendChild(tr);
  });
  
  if(qs('#cardTotalValue')) qs('#cardTotalValue').textContent = `RM ${totalValue.toFixed(2)}`;
  if(qs('#cardTotalRevenue')) qs('#cardTotalRevenue').textContent = `RM ${totalRevenue.toFixed(2)}`;
  if(qs('#cardTotalProfit')) qs('#cardTotalProfit').textContent = `RM ${totalProfit.toFixed(2)}`;
  if(qs('#cardTotalStock')) qs('#cardTotalStock').textContent = totalStock;
  if(qs('#cardTotalProducts')) qs('#cardTotalProducts').textContent = items.length;
}

function searchInventory(){
  const q = (qs('#searchInput')?.value || '').toLowerCase().trim();
  const start = qs('#startDate')?.value;
  const end = qs('#endDate')?.value;
  
  let filtered = inventory.filter(i => 
    (i.sku||'').toLowerCase().includes(q) || (i.name||'').toLowerCase().includes(q)
  );

  if(start || end) {
    filtered = filtered.filter(i => {
      const d = new Date(i.createdAt);
      if(start && d < new Date(start)) return false;
      if(end) {
        const e = new Date(end); e.setHours(23,59,59);
        if(d > e) return false;
      }
      return true;
    });
    updateDateRangeStatus(true, start, end);
  } else {
    updateDateRangeStatus(false);
  }
  renderInventory(filtered);
}

function updateDateRangeStatus(active, s, e) {
  const el = qs('.date-range-status') || (() => { const x=document.createElement('span'); x.className='date-range-status'; qs('.date-range-container').appendChild(x); return x; })();
  el.textContent = active ? `Filter: ${s||'?'} to ${e||'?'}` : '';
  el.style.display = active ? 'inline' : 'none';
}

async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value;
  const name = qs('#p_name')?.value;
  if(!sku || !name) return alert('Enter SKU/Name');
  
  const body = {
    sku, name, category: qs('#p_category')?.value,
    quantity: qs('#p_quantity')?.value, unitCost: qs('#p_unitCost')?.value, unitPrice: qs('#p_unitPrice')?.value
  };
  
  if(await (await apiFetch(`${API_BASE}/inventory`, {method:'POST', body:JSON.stringify(body)})).ok) {
    alert('Added!'); window.location.reload();
  } else alert('Failed');
}

async function confirmAndDeleteItem(id){
  if(confirm('Delete?')) {
    await apiFetch(`${API_BASE}/inventory/${id}`, {method:'DELETE'});
    fetchInventory();
  }
}

function openEditPageForItem(id){ window.location.href = `product.html?id=${id}`; }

// =========================================
// PURCHASES
// =========================================
async function fetchPurchases() {
  const res = await apiFetch(`${API_BASE}/purchases`);
  if(res.ok) { purchases = (await res.json()).map(x => ({...x, id: x.id||x._id})); renderPurchases(); }
}
function renderPurchases() {
  const list = qs('#purchaseHistoryList');
  if(!list) return;
  list.innerHTML = '';
  purchases.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.purchaseId}</td><td>${p.supplier}</td><td>${p.items?.length||0}</td>
      <td>RM ${(p.totalAmount||0).toFixed(2)}</td><td>${new Date(p.purchaseDate).toLocaleDateString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="viewPurchaseDetails('${p.id}')">👁️</button>
        <button class="danger-btn small-btn" onclick="deletePurchase('${p.id}')">🗑️</button>
        <button class="success-btn small-btn" onclick="printPurchaseInvoice('${p.id}')">🖨️</button>
      </td>`;
    list.appendChild(tr);
  });
}
function openPurchaseHistoryModal() { qs('#purchaseHistoryModal').style.display='block'; fetchPurchases(); }
function openNewPurchaseModal() { 
  qs('#newPurchaseModal').style.display='block'; 
  qs('#purchaseItems').innerHTML = ''; 
  qs('#totalPurchaseAmount').textContent='0.00';
  loadProductSearch('#productSearch', '#productResults', addPurchaseItem);
}

function addPurchaseItem(item) {
  const div = document.createElement('div');
  div.className = 'purchase-item-row';
  div.innerHTML = `
    <input class="p-sku" value="${item.sku}" readonly>
    <input class="p-name" value="${item.name}" readonly>
    <input type="number" class="p-qty" value="1" min="1" onchange="updateRowTotal(this)">
    <input type="number" class="p-price" value="${item.unitCost}" onchange="updateRowTotal(this)">
    <input class="p-total" value="${item.unitCost}" readonly>
    <button onclick="this.parentElement.remove(); calcPurchaseTotal()">❌</button>
  `;
  qs('#purchaseItems').appendChild(div);
  calcPurchaseTotal();
}
window.updateRowTotal = (el) => {
  const row = el.parentElement;
  const q = row.querySelector('.p-qty').value;
  const p = row.querySelector('.p-price').value;
  row.querySelector('.p-total').value = (q*p).toFixed(2);
  calcPurchaseTotal();
};
function calcPurchaseTotal() {
  let tot = 0;
  qsa('.purchase-item-row').forEach(r => tot += Number(r.querySelector('.p-total').value));
  if(qs('#totalPurchaseAmount')) qs('#totalPurchaseAmount').textContent = tot.toFixed(2);
  if(qs('#totalSalesAmount')) qs('#totalSalesAmount').textContent = tot.toFixed(2);
}

async function savePurchaseOrder() {
  const items = qsa('.purchase-item-row').map(r => ({
    sku: r.querySelector('.p-sku').value,
    productName: r.querySelector('.p-name').value,
    quantity: Number(r.querySelector('.p-qty').value),
    purchasePrice: Number(r.querySelector('.p-price').value)
  }));
  if(items.length===0) return alert('No items');
  
  const body = {
    supplier: qs('#supplierName').value,
    purchaseDate: qs('#purchaseDate').value,
    notes: qs('#purchaseNotes').value,
    items
  };
  
  const res = await apiFetch(`${API_BASE}/purchases`, {method:'POST', body:JSON.stringify(body)});
  if(res.ok) { alert('Saved!'); qs('#newPurchaseModal').style.display='none'; fetchInventory(); }
}

async function viewPurchaseDetails(id) {
  const p = await (await apiFetch(`${API_BASE}/purchases/${id}`)).json();
  qs('#detailPurchaseId').textContent = p.purchaseId;
  qs('#detailSupplier').textContent = p.supplier;
  qs('#detailTotalAmount').textContent = p.totalAmount.toFixed(2);
  const tbody = qs('#purchaseDetailsList');
  tbody.innerHTML = '';
  p.items.forEach(i => {
    tbody.innerHTML += `<tr><td>${i.sku}</td><td>${i.productName}</td><td>${i.quantity}</td><td>${i.purchasePrice}</td><td>${i.totalAmount}</td></tr>`;
  });
  qs('#printDetailsInvoiceBtn').onclick = () => printPurchaseInvoice(id);
  qs('#purchaseDetailsModal').style.display='block';
}

async function printPurchaseInvoice(id) {
  const res = await fetch(`${API_BASE}/purchases/invoice/${id}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`Inv_${id}.pdf`; a.click();
}
async function deletePurchase(id) {
  if(confirm('Delete?')) { await apiFetch(`${API_BASE}/purchases/${id}`, {method:'DELETE'}); fetchPurchases(); fetchInventory(); }
}

// =========================================
// SALES
// =========================================
async function fetchSales() {
  const res = await apiFetch(`${API_BASE}/sales`);
  if(res.ok) { sales = (await res.json()).map(x => ({...x, id: x.id||x._id})); renderSales(); }
}
function renderSales() {
  const list = qs('#salesHistoryList');
  if(!list) return;
  list.innerHTML = '';
  sales.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.salesId}</td><td>${s.customer}</td><td>${s.items?.length||0}</td>
      <td>RM ${(s.totalAmount||0).toFixed(2)}</td><td>${new Date(s.salesDate).toLocaleDateString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="viewSalesDetails('${s.id}')">👁️</button>
        <button class="danger-btn small-btn" onclick="deleteSales('${s.id}')">🗑️</button>
        <button class="success-btn small-btn" onclick="printSalesInvoice('${s.id}')">🖨️</button>
      </td>`;
    list.appendChild(tr);
  });
}
function openSalesHistoryModal() { qs('#salesHistoryModal').style.display='block'; fetchSales(); }
function openNewSalesModal() { 
  qs('#newSalesModal').style.display='block'; 
  qs('#salesItems').innerHTML = ''; 
  qs('#totalSalesAmount').textContent='0.00';
  loadProductSearch('#productSearchSales', '#productResultsSales', addSalesItem);
}

function addSalesItem(item) {
  const div = document.createElement('div');
  div.className = 'purchase-item-row'; // Reuse style
  div.innerHTML = `
    <input class="p-sku" value="${item.sku}" readonly>
    <input class="p-name" value="${item.name}" readonly>
    <input type="number" class="p-qty" value="1" min="1" max="${item.quantity}" onchange="updateRowTotal(this)">
    <input type="number" class="p-price" value="${item.unitPrice}" onchange="updateRowTotal(this)">
    <input class="p-total" value="${item.unitPrice}" readonly>
    <button onclick="this.parentElement.remove(); calcPurchaseTotal()">❌</button>
  `;
  qs('#salesItems').appendChild(div);
  calcPurchaseTotal();
}

async function saveSalesOrder() {
  const items = qsa('#salesItems .purchase-item-row').map(r => ({
    sku: r.querySelector('.p-sku').value,
    productName: r.querySelector('.p-name').value,
    quantity: Number(r.querySelector('.p-qty').value),
    salePrice: Number(r.querySelector('.p-price').value)
  }));
  if(items.length===0) return alert('No items');
  
  const body = {
    customer: qs('#customerName').value,
    salesDate: qs('#salesDate').value,
    notes: qs('#salesNotes').value,
    items
  };
  
  const res = await apiFetch(`${API_BASE}/sales`, {method:'POST', body:JSON.stringify(body)});
  if(res.ok) { alert('Saved!'); qs('#newSalesModal').style.display='none'; fetchInventory(); }
  else alert((await res.json()).message);
}

async function viewSalesDetails(id) {
  const s = await (await apiFetch(`${API_BASE}/sales/${id}`)).json();
  qs('#detailSalesId').textContent = s.salesId;
  qs('#detailCustomer').textContent = s.customer;
  qs('#detailSalesTotalAmount').textContent = s.totalAmount.toFixed(2);
  const tbody = qs('#salesDetailsList');
  tbody.innerHTML = '';
  s.items.forEach(i => {
    tbody.innerHTML += `<tr><td>${i.sku}</td><td>${i.productName}</td><td>${i.quantity}</td><td>${i.salePrice}</td><td>${i.totalAmount}</td></tr>`;
  });
  qs('#printSalesInvoiceBtn').onclick = () => printSalesInvoice(id);
  qs('#salesDetailsModal').style.display='block';
}

async function printSalesInvoice(id) {
  const res = await fetch(`${API_BASE}/sales/invoice/${id}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`Inv_${id}.pdf`; a.click();
}
async function deleteSales(id) {
  if(confirm('Delete?')) { await apiFetch(`${API_BASE}/sales/${id}`, {method:'DELETE'}); fetchSales(); fetchInventory(); }
}

// =========================================
// SEARCH HELPER
// =========================================
function loadProductSearch(inputSel, resSel, callback) {
  const inp = qs(inputSel);
  const res = qs(resSel);
  inp.oninput = () => {
    const q = inp.value.toLowerCase();
    res.innerHTML = '';
    if(q.length<2) return;
    inventory.filter(i=>i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)).forEach(i => {
      const d = document.createElement('div');
      d.className = 'product-result-item';
      d.textContent = `${i.sku} - ${i.name} (Stock: ${i.quantity})`;
      d.onclick = () => { callback(i); inp.value=''; res.innerHTML=''; };
      res.appendChild(d);
    });
  };
}

// =========================================
// REPORTS & STATEMENTS (FIXED)
// =========================================
function openReportModal() { qs('#reportModal').style.display='block'; }
async function generateSelectedReport() {
  const type = qs('#selectedReportType').value;
  const start = qs('#reportStartDate').value;
  const end = qs('#reportEndDate').value;
  
  if(type === 'all') {
    await genRep('inventory', start, end);
    await genRep('purchase', start, end);
    await genRep('sales', start, end);
  } else {
    await genRep(type, start, end);
  }
}
async function genRep(type, s, e) {
  let ep = type === 'inventory' ? '/inventory/report/pdf' : (type === 'purchase' ? '/purchases/report/pdf' : '/sales/report/pdf');
  const res = await apiFetch(`${API_BASE}${ep}`, {method:'POST', body:JSON.stringify({startDate:s, endDate:e})});
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`${type}_Report.pdf`; a.click();
}

async function openStatementsModal() {
  qs('#statementsModal').style.display='block';
  await loadStatementSummary();
  switchTab('inventory-reports');
}

async function loadStatementSummary() {
  const s = (await (await apiFetch(`${API_BASE}/statements-summary`)).json()).summary;
  if(qs('#inventoryReportsCount')) qs('#inventoryReportsCount').textContent = s.inventoryReports;
  if(qs('#purchaseInvoicesCount')) qs('#purchaseInvoicesCount').textContent = s.purchaseInvoices;
  if(qs('#salesInvoicesCount')) qs('#salesInvoicesCount').textContent = s.salesInvoices;
  if(qs('#purchaseReportsCount')) qs('#purchaseReportsCount').textContent = s.purchaseReports;
  if(qs('#salesReportsCount')) qs('#salesReportsCount').textContent = s.salesReports;
  if(qs('#totalReportsCount')) qs('#totalReportsCount').textContent = s.totalReports;
  if(qs('#totalInvoicesCount')) qs('#totalInvoicesCount').textContent = s.totalInvoices;
  if(qs('#totalDocumentsCount')) qs('#totalDocumentsCount').textContent = s.totalDocuments;
}

async function switchTab(tab) {
  qsa('.tab-button').forEach(b => b.classList.remove('active'));
  qs(`#tab-${tab}`).classList.add('active');
  qsa('.tab-content').forEach(c => c.classList.remove('active'));
  qs(`#content-${tab}`).classList.add('active');
  
  const res = await apiFetch(`${API_BASE}/statements/${tab}`);
  const docs = (await res.json()).documents;
  
  // FIXED: Correct ID mapping
  let listId = '';
  if(tab==='inventory-reports') listId='#inventoryReportsList';
  else if(tab==='purchase-invoices') listId='#purchaseInvoicesList';
  else if(tab==='sales-invoices') listId='#salesInvoicesList';
  else if(tab==='purchase-reports') listId='#purchaseReportsList';
  else if(tab==='sales-reports') listId='#salesReportsList';
  else if(tab==='all-reports') listId='#allReportsList';
  else if(tab==='all-invoices') listId='#allInvoicesList';
  
  const list = qs(listId);
  list.innerHTML = '';
  if(docs.length === 0) list.innerHTML = '<tr><td colspan="4">No documents</td></tr>';
  docs.forEach(d => {
    list.innerHTML += `<tr>
      <td>${d.name}</td>
      <td>${(d.size/1024/1024).toFixed(2)} MB</td>
      <td>${new Date(d.date).toLocaleString()}</td>
      <td class="actions">
        <button onclick="previewDocument('${d.id}','${d.name}')">👁️</button>
        <button onclick="downloadDocument('${d.id}','${d.name}')">⬇️</button>
        <button onclick="deleteDocumentConfirm('${d.id}')">🗑️</button>
      </td>
    </tr>`;
  });
}

function selectReportType(t) {
  qsa('.report-option').forEach(o => o.classList.remove('selected'));
  qs(`#report-${t}`).classList.add('selected');
  qs('#selectedReportType').value = t;
}

// =========================================
// FOLDERS & DOCS
// =========================================
async function fetchFolders() {
  const f = await (await apiFetch(`${API_BASE}/folders`)).json();
  folders = f.map(x=>({...x,id:x.id||x._id}));
  renderFolders();
}
function renderFolders() {
  const d = qs('#folderList'); if(!d) return;
  d.innerHTML = '';
  const curr = folders.filter(f => currentFolder==='root' ? !f.parentFolder : f.parentFolder===currentFolder);
  curr.forEach(f => {
    const div = document.createElement('div');
    div.className = 'folder-item';
    div.innerHTML = `<div class="folder-icon">📁</div><div>${f.name}</div>
      <div class="folder-actions"><button onclick="deleteFolder('${f.id}')">🗑️</button></div>`;
    div.onclick = (e) => { if(!e.target.closest('button')) navigateToFolder(f.id); };
    d.appendChild(div);
  });
  updateBreadcrumb();
}
function navigateToFolder(id) { currentFolder=id; fetchDocuments(); renderFolders(); }
function updateBreadcrumb() {
  const b = qs('#folderBreadcrumb');
  b.innerHTML = `<span onclick="navigateToFolder('root')">Root</span>`;
  if(currentFolder !== 'root') {
    const f = folders.find(x=>x.id===currentFolder);
    if(f) b.innerHTML += ` > <span>${f.name}</span>`;
  }
}
async function createFolder() {
  const n = prompt('Name'); if(!n) return;
  await apiFetch(`${API_BASE}/folders`, {method:'POST', body:JSON.stringify({name:n, parentFolder:currentFolder==='root'?null:currentFolder})});
  fetchFolders();
}
async function deleteFolder(id) { if(confirm('Delete?')) { await apiFetch(`${API_BASE}/folders/${id}`, {method:'DELETE'}); fetchFolders(); } }

async function fetchDocuments() {
  const url = currentFolder==='root' ? `${API_BASE}/documents?folder=root` : `${API_BASE}/documents?folder=${currentFolder}`;
  documents = await (await apiFetch(url)).json();
  renderDocuments(documents);
}
function renderDocuments(docs) {
  const l = qs('#docList'); if(!l) return;
  l.innerHTML = '';
  docs.forEach(d => {
    l.innerHTML += `<tr>
      <td>${d.name}</td><td>${(d.size/1024/1024).toFixed(2)} MB</td><td>${new Date(d.date).toLocaleString()}</td>
      <td>
        <button onclick="downloadDocument('${d.id}','${d.name}')">⬇️</button>
        <button onclick="previewDocument('${d.id}','${d.name}')">👁️</button>
        <button onclick="deleteDocumentConfirm('${d.id}')">🗑️</button>
      </td>
    </tr>`;
  });
}
async function uploadDocuments() {
  const f = qs('#docUpload').files[0]; if(!f) return;
  const res = await fetch(`${API_BASE}/documents`, {
    method:'POST', body:f,
    headers: { 
      'X-Username':getUsername(), 
      'X-File-Name':encodeURIComponent(f.name),
      'X-Folder-Id': currentFolder==='root'?'':currentFolder
    }
  });
  if(res.ok) { alert('Uploaded'); fetchDocuments(); }
}
async function downloadDocument(id, name) {
  const res = await fetch(`${API_BASE}/documents/download/${id}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=name; a.click();
}
function previewDocument(id, name) {
  qs('#previewModal').style.display='block';
  qs('#previewTitle').textContent = name;
  qs('#previewIframe').src = `${API_BASE}/documents/preview/${id}`;
}
async function deleteDocumentConfirm(id) { if(confirm('Delete?')) { await apiFetch(`${API_BASE}/documents/${id}`, {method:'DELETE'}); fetchDocuments(); } }

// =========================================
// LOGS & DASHBOARD
// =========================================
async function fetchLogs() {
  const l = await (await apiFetch(`${API_BASE}/logs`)).json();
  activityLog = l;
  const t = qs('#logList'); if(t) {
    t.innerHTML = '';
    l.forEach(x => t.innerHTML += `<tr><td>${x.user}</td><td>${x.action}</td><td>${new Date(x.time).toLocaleString()}</td></tr>`);
  }
}
function renderDashboardData() {
  if(qs('#dash_totalItems')) qs('#dash_totalItems').textContent = inventory.length;
}

// =========================================
// INIT
// =========================================
window.onload = async () => {
  initializeTheme();
  if(qs('#adminName')) qs('#adminName').textContent = getUsername();
  await fetchCompanyInfo();
  
  if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
  if(currentPage.includes('documents')) { await fetchFolders(); await fetchDocuments(); bindDocumentsUI(); }
  if(currentPage.includes('log') || !currentPage || currentPage==='index.html') { await fetchLogs(); await fetchInventory(); }
  if(currentPage.includes('product')) bindProductPage();
};

function bindInventoryUI() {
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', openReportModal);
  qs('#statementsBtn')?.addEventListener('click', openStatementsModal);
  qs('#searchInput')?.addEventListener('input', searchInventory);
  
  // Close Modals
  qsa('.close').forEach(x => x.onclick = function() { this.closest('.modal').style.display='none'; });
  
  // Modal Triggers
  qs('#purchaseHistoryBtn')?.addEventListener('click', openPurchaseHistoryModal);
  qs('#newPurchaseBtn')?.addEventListener('click', openNewPurchaseModal);
  qs('#savePurchaseBtn')?.addEventListener('click', savePurchaseOrder);
  
  qs('#salesHistoryBtn')?.addEventListener('click', openSalesHistoryModal);
  qs('#newSalesBtn')?.addEventListener('click', openNewSalesModal);
  qs('#saveSalesBtn')?.addEventListener('click', saveSalesOrder);
  
  qs('#generateReportBtn')?.addEventListener('click', generateSelectedReport);
  
  bindDateRangeFilterEvents();
}
function bindDocumentsUI() {
  qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments);
  qs('#createFolderBtn')?.addEventListener('click', createFolder);
  qs('#searchDocs')?.addEventListener('input', searchDocuments);
}
function searchDocuments() {
  const q = qs('#searchDocs').value.toLowerCase();
  renderDocuments(documents.filter(d=>d.name.toLowerCase().includes(q)));
}
function bindDateRangeFilterEvents() {
  qs('#applyDateRangeBtn')?.addEventListener('click', searchInventory);
  qs('#clearDateRangeBtn')?.addEventListener('click', () => { qs('#startDate').value=''; qs('#endDate').value=''; searchInventory(); });
}
function bindProductPage() {
  const id = new URLSearchParams(window.location.search).get('id');
  if(!id) return;
  apiFetch(`${API_BASE}/inventory`).then(r=>r.json()).then(d => {
    const i = d.find(x => (x.id||x._id) === id);
    if(i) {
      qs('#prod_id').value = i.id||i._id;
      qs('#prod_sku').value = i.sku; qs('#prod_name').value = i.name;
      qs('#prod_category').value = i.category; qs('#prod_quantity').value = i.quantity;
      qs('#prod_unitCost').value = i.unitCost; qs('#prod_unitPrice').value = i.unitPrice;
    }
  });
  qs('#saveProductBtn')?.addEventListener('click', async () => {
    const id = qs('#prod_id').value;
    const body = {
      sku: qs('#prod_sku').value, name: qs('#prod_name').value, category: qs('#prod_category').value,
      quantity: qs('#prod_quantity').value, unitCost: qs('#prod_unitCost').value, unitPrice: qs('#prod_unitPrice').value
    };
    await apiFetch(`${API_BASE}/inventory/${id}`, {method:'PUT', body:JSON.stringify(body)});
    alert('Updated'); window.location.href='inventory.html';
  });
}
