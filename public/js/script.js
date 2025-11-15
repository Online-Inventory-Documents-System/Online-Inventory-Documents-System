// public/js/script.js
// Final client-side script for Online Inventory & Documents System
// Uses API_BASE to call the server. Exposes helper functions used by inline onclick handlers.

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : (window.API_BASE_OVERRIDE || "https://online-inventory-documents-system-olzt.onrender.com/api");

// Utilities
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';
const getUserRole = () => sessionStorage.getItem('adminRole') || sessionStorage.getItem('role') || 'staff';

let inventory = [];
let activityLog = [];
let documents = [];
let companyInfo = null;
const currentPage = window.location.pathname.split('/').pop();

// Fetch wrapper adds X-Username header and handles no-body responses
async function apiFetch(url, options = {}) {
  const user = getUsername();
  options.headers = {
    'X-Username': user,
    ...options.headers
  };

  // Ensure content-type for JSON requests where body is present
  if (options.body && !options.headers['Content-Type']) {
    options.headers['Content-Type'] = 'application/json';
  }

  return fetch(url, options);
}

// Helper to safely parse JSON if possible
async function tryParseJson(response) {
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return response.json();
  }
  // Not JSON — return null so caller can handle or fallback
  return null;
}

// Redirect to login if not logged in (except login page)
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  try { window.location.href = 'login.html'; } catch(e) {}
}

function logout(){
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('adminName');
  sessionStorage.removeItem('adminRole');
  if(window.CONFIG && CONFIG.LS_THEME) localStorage.removeItem(CONFIG.LS_THEME);
  window.location.href = 'login.html';
}

function toggleTheme(){
  document.body.classList.toggle('dark-mode');
  if(window.CONFIG && CONFIG.LS_THEME) {
    localStorage.setItem(CONFIG.LS_THEME, document.body.classList.contains('dark-mode') ? 'dark' : 'light');
  }
}

// ----------------- Renderers -----------------
function renderInventory(items) {
  const list = qs('#inventoryList');
  if(!list) return;
  list.innerHTML = '';
  let totalValue = 0, totalRevenue = 0, totalStock = 0;

  items.forEach(it => {
    const id = it.id || it._id;
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const invVal = qty * uc;
    const rev = qty * up;
    totalValue += invVal;
    totalRevenue += rev;
    totalStock += qty;

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
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditPageForItem('${id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="confirmAndDeleteItem('${id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });

  if(qs('#totalValue')) qs('#totalValue').textContent = totalValue.toFixed(2);
  if(qs('#totalRevenue')) qs('#totalRevenue').textContent = totalRevenue.toFixed(2);
  if(qs('#totalStock')) qs('#totalStock').textContent = totalStock;
}

function renderDocuments(docs) {
  const list = qs('#docList');
  if(!list) return;
  list.innerHTML = '';

  docs.forEach(d => {
    const id = d.id || d._id;
    const sizeMB = ((d.sizeBytes || d.size || 0) / (1024*1024)).toFixed(2);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(d.name||'')}</td>
      <td>${sizeMB} MB</td>
      <td>${new Date(d.date).toLocaleString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="downloadDocument('${encodeURIComponent(d.name||'')}')">⬇️ Download</button>
        <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${id}')">🗑️ Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });
}

function renderLogs() {
  const list = qs('#logList');
  if(list) {
    list.innerHTML = '';
    [...activityLog].forEach(l => {
      const timeStr = l.time ? new Date(l.time).toLocaleString() : new Date().toLocaleString();
      const li = document.createElement('li');
      li.innerHTML = `[${escapeHtml(timeStr)}] <b>${escapeHtml(l.user||'System')}</b>: ${escapeHtml(l.action||'')}`;
      list.appendChild(li);
    });
  }
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
      totalValue += qty * Number(it.unitCost || 0);
      totalRevenue += qty * Number(it.unitPrice || 0);
      totalStock += qty;
    });
    qs('#dash_totalItems').textContent = inventory.length;
    qs('#dash_totalValue').textContent = totalValue.toFixed(2);
    qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
    qs('#dash_totalStock').textContent = totalStock;
  }
}

// ----------------- Fetchers -----------------
async function fetchCompanyInfo(){
  try {
    const res = await apiFetch(`${API_BASE}/company`);
    if(!res.ok) throw new Error(`Failed to fetch company (status ${res.status})`);
    companyInfo = await tryParseJson(res) || null;
  } catch (err) {
    console.warn('Failed to load company info:', err);
    companyInfo = null;
  }
  if(companyInfo && companyInfo.taxPercent !== undefined) {
    const taxEl = qs('#taxText');
    if(taxEl) taxEl.textContent = `${Number(companyInfo.taxPercent).toFixed(0)}%`;
  }
}

async function fetchInventory() {
  try {
    const res = await apiFetch(`${API_BASE}/inventory`);
    if(!res.ok) throw new Error(`Failed to fetch inventory (status ${res.status})`);
    const data = await tryParseJson(res) || [];
    inventory = data.map(i => ({ ...i, id: i.id || i._id }));
    renderInventory(inventory);
    renderDashboardData();
  } catch(err) { console.error(err); inventory = []; }
}

async function fetchDocuments() {
  try {
    const res = await apiFetch(`${API_BASE}/documents`);
    if(!res.ok) throw new Error(`Failed to fetch documents (status ${res.status})`);
    const data = await tryParseJson(res) || [];
    documents = data.map(d => ({ ...d, id: d.id || d._id }));
    renderDocuments(documents);
  } catch(err) { console.error(err); documents = []; }
}

async function fetchLogs() {
  try {
    const res = await apiFetch(`${API_BASE}/logs`);
    if(!res.ok) throw new Error(`Failed to fetch logs (status ${res.status})`);
    activityLog = await tryParseJson(res) || [];
    renderLogs();
  } catch(err) { console.error(err); activityLog = []; }
}

// ----------------- Init -----------------
window.addEventListener('load', async () => {
  const adminName = getUsername();
  if(qs('#adminName')) qs('#adminName').textContent = adminName;
  const role = getUserRole();
  if(qs('#adminRole')) qs('#adminRole').textContent = role;

  const theme = (window.CONFIG && CONFIG.LS_THEME) ? localStorage.getItem(CONFIG.LS_THEME) : null;
  if(theme === 'dark') document.body.classList.add('dark-mode');

  try {
    await fetchCompanyInfo();
    if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
    if(currentPage.includes('documents')) { await fetchDocuments(); bindDocumentsUI(); }
    if(currentPage.includes('log') || currentPage === '' || currentPage === 'index.html') { await fetchLogs(); await fetchInventory(); }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
    if(currentPage.includes('sales')) bindSalesPage();
    if(currentPage.includes('orders')) bindOrdersPage();
  } catch(e) { console.error('Init error', e); }
});

// ----------------- Auth -----------------
async function login(){
  const user = qs('#username')?.value?.trim();
  const pass = qs('#password')?.value?.trim();
  const msg = qs('#loginMessage');
  showMsg(msg, '');
  if(!user || !pass) { showMsg(msg, '⚠️ Please enter username and password.', 'red'); return; }

  try {
    const res = await apiFetch(`${API_BASE}/login`, { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
    // parse JSON only if server returned JSON
    const data = await tryParseJson(res);
    if(res.ok) {
      sessionStorage.setItem('isLoggedIn', 'true');
      // server returns either { success:true, user: { username, role } } or similar
      const role = data && data.user && data.user.role ? data.user.role : (data && data.role) ? data.role : 'admin';
      sessionStorage.setItem('adminName', user);
      sessionStorage.setItem('adminRole', role);
      showMsg(msg, '✅ Login successful! Redirecting...', 'green');
      setTimeout(()=> window.location.href = 'index.html', 600);
    } else {
      // try to show server message, otherwise construct helpful message
      const serverMessage = data && data.message ? data.message : `Login failed (status ${res.status})`;
      showMsg(msg, `❌ ${serverMessage}`, 'red');
    }
  } catch(e) {
    showMsg(msg, '❌ Server connection failed.', 'red');
    console.error('login error', e);
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
    const data = await tryParseJson(res);
    if(res.ok) {
      showMsg(msg, '✅ Registered successfully! You can now log in.', 'green');
      setTimeout(()=> toggleForm(), 900);
    } else {
      const serverMessage = data && data.message ? data.message : `Registration failed (status ${res.status})`;
      showMsg(msg, `❌ ${serverMessage}`, 'red');
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

// ----------------- Inventory CRUD -----------------
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
    const data = await tryParseJson(res);
    if(res.ok) {
      ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id => { if(qs(id)) qs(id).value = ''; });
      await fetchInventory();
      if(currentPage.includes('inventory')) await fetchLogs();
      alert('✅ Product added successfully.');
    } else {
      alert('❌ Failed to add product: ' + (data && data.message ? data.message : `status ${res.status}`));
    }
  } catch(e) { console.error(e); alert('❌ Server connection error while adding product.'); }
}

async function confirmAndDeleteItem(id){
  const it = inventory.find(x => String(x.id) === String(id));
  if(!it) return;
  if(!confirm(`Confirm Delete: "${it.name}"?`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method: 'DELETE' });
    if(res.status === 204 || res.ok) {
      await fetchInventory();
      alert('🗑️ Item deleted!');
    } else {
      const data = await tryParseJson(res);
      alert('❌ Failed to delete item: ' + (data && data.message ? data.message : `status ${res.status}`));
    }
  } catch(e) { console.error(e); alert('❌ Server connection error while deleting product.'); }
}

async function confirmAndGenerateReportPDF(type='inventory') {
  // type: inventory | sales | orders
  if(!confirm(`Confirm generate ${type.toUpperCase()} PDF report?`)) return;
  try {
    const urlMap = {
      inventory: `${API_BASE}/inventory/report/pdf`,
      sales: `${API_BASE}/sales/report/pdf`,
      orders: `${API_BASE}/orders/report/pdf`
    };
    const url = urlMap[type] || urlMap.inventory;
    window.open(url, '_blank');
  } catch(e) {
    console.error('report pdf error', e);
    alert('Failed to request PDF report.');
  }
}

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', ()=> confirmAndGenerateReportPDF('inventory'));
  qs('#searchInput')?.addEventListener('input', searchInventory);
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { if(qs('#searchInput')) { qs('#searchInput').value=''; searchInventory(); } });
}

function searchInventory(){
  const q = (qs('#searchInput')?.value || '').toLowerCase().trim();
  const filtered = inventory.filter(item => (item.sku||'').toLowerCase().includes(q) || (item.name||'').toLowerCase().includes(q) || (item.category||'').toLowerCase().includes(q));
  renderInventory(filtered);
}

// Product edit page
function openEditPageForItem(id){ window.location.href = `product.html?id=${encodeURIComponent(id)}`; }

async function bindProductPage(){
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if(id) {
    try {
      const res = await apiFetch(`${API_BASE}/inventory`);
      const items = await tryParseJson(res) || [];
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
      else { const data = await tryParseJson(res); alert('❌ Failed to update item: ' + (data && data.message ? data.message : 'Unknown')); }
    } catch(e) { console.error(e); alert('❌ Server connection error during update.'); }
  });

  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href = 'inventory.html');
}

// Documents
async function uploadDocuments(){
  const files = qs('#docUpload')?.files || [];
  let msgEl = qs('#uploadMessage');
  if(!msgEl){ msgEl = document.createElement('p'); msgEl.id = 'uploadMessage'; if(qs('.controls')) qs('.controls').appendChild(msgEl); }

  if(files.length === 0) { showMsg(msgEl, '⚠️ Please select files to upload.', 'red'); return; }
  if(!confirm(`Confirm Upload: Upload metadata for ${files.length} document(s)?`)) { showMsg(msgEl, 'Upload cancelled.', 'orange'); return; }
  showMsg(msgEl, `Uploading ${files.length} document(s) metadata...`, 'orange');

  for(let i=0;i<files.length;i++){
    const f = files[i];
    const meta = { name: f.name, type: f.type, sizeBytes: f.size };
    try {
      const res = await apiFetch(`${API_BASE}/documents`, { method: 'POST', body: JSON.stringify(meta) });
      if(!res.ok) throw new Error('Server responded with an error.');
      showMsg(msgEl, `✅ Uploaded metadata for ${f.name}.`, 'green');
    } catch(e) {
      console.error(e);
      showMsg(msgEl, `❌ Failed to upload metadata for ${f.name}.`, 'red');
      return;
    }
  }

  if(qs('#docUpload')) qs('#docUpload').value = '';
  setTimeout(async ()=> { await fetchDocuments(); if(msgEl) msgEl.remove(); }, 1000);
}

function downloadDocument(fileNameEncoded) {
  const fileName = decodeURIComponent(fileNameEncoded);
  if(!confirm(`Confirm Download: ${fileName}?`)) return;
  window.open(`${API_BASE}/documents/download/${encodeURIComponent(fileName)}`, '_blank');
}

async function deleteDocumentConfirm(id) {
  const doc = documents.find(d => String(d.id) === String(id));
  if(!doc) return;
  if(!confirm(`Delete document metadata for: ${doc.name}?`)) return;
  await deleteDocument(id);
}

async function deleteDocument(id) {
  try {
    const res = await apiFetch(`${API_BASE}/documents/${id}`, { method: 'DELETE' });
    if(res.status === 204 || res.ok) { await fetchDocuments(); alert('🗑️ Document metadata deleted successfully!'); }
    else { const data = await tryParseJson(res); alert('❌ Failed to delete document metadata: ' + (data && data.message ? data.message : `status ${res.status}`)); }
  } catch(e) { console.error(e); alert('❌ Server error while deleting document metadata.'); }
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
      const data = await tryParseJson(res);
      if(res.ok) {
        showMsg(msgEl, '✅ Password updated successfully! Please log in again.', 'green');
        qs('#newPassword').value = '';
        qs('#confirmPassword').value = '';
        qs('#securityCode').value = '';
        setTimeout(logout, 1500);
      } else {
        showMsg(msgEl, `❌ ${data && data.message ? data.message : 'Failed to change password.'}`, 'red');
      }
    } catch(e) { showMsg(msgEl, '❌ Server connection failed during password change.', 'red'); console.error(e); }
  });

  qs('#deleteAccountBtn')?.addEventListener('click', async ()=> {
    if(!confirm(`⚠️ WARNING: Are you absolutely sure you want to delete the account for "${currentUsername}"?`)) return;
    const code = prompt('Enter Admin Security Code to CONFIRM account deletion:');
    if(!code) return alert('Deletion cancelled.');
    try {
      const res = await apiFetch(`${API_BASE}/account`, { method: 'DELETE', body: JSON.stringify({ username: currentUsername, securityCode: code }) });
      const data = await tryParseJson(res);
      if(res.ok) { alert('🗑️ Account deleted successfully. You will now be logged out.'); logout(); }
      else alert(`❌ ${data && data.message ? data.message : 'Failed to delete account.'}`);
    } catch(e) { alert('❌ Server connection failed during account deletion.'); console.error(e); }
  });
}

// ----------------- Sales & Orders page binding helpers -----------------
function bindSalesPage(){
  qs('#downloadSalesPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/sales/report/pdf`, '_blank'));
  qs('#downloadSalesXLSXBtnInline')?.addEventListener('click', ()=> window.open(`${API_BASE}/sales/report`, '_blank'));
}

function bindOrdersPage(){
  qs('#downloadOrdersPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/orders/report/pdf`, '_blank'));
  qs('#downloadOrdersXLSXBtnInline')?.addEventListener('click', ()=> window.open(`${API_BASE}/orders/report`, '_blank'));
}

// ----------------- DOM READY short bindings -----------------
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
window.confirmAndGenerateReportPDF = confirmAndGenerateReportPDF;
