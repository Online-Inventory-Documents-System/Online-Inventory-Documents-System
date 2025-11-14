\// public/js/script.js
// Full client code for Inventory & Documents System.
// Set API_BASE automatically for localhost or production.

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : (window.__API_BASE__ || "https://online-inventory-documents-system-olzt.onrender.com/api");

// Utilities
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color='red') => { if(!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = s => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [];
let activityLog = [];
let documents = [];
let sales = [];
let orders = [];

const currentPage = window.location.pathname.split('/').pop();

// API fetch wrapper
async function apiFetch(url, opts = {}) {
  const user = getUsername();
  opts.headers = { 'Content-Type': 'application/json', 'X-Username': user, ...(opts.headers||{}) };
  return fetch(url, opts);
}

// Auth redirect
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  try { window.location.href = 'login.html'; } catch(e) {}
}

function logout() {
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('adminName');
  if(window.CONFIG && CONFIG.LS_THEME) localStorage.removeItem(CONFIG.LS_THEME);
  window.location.href = 'login.html';
}
function toggleTheme(){
  document.body.classList.toggle('dark-mode');
  if(window.CONFIG && CONFIG.LS_THEME) localStorage.setItem(CONFIG.LS_THEME, document.body.classList.contains('dark-mode') ? 'dark' : 'light');
}

// Renderers
function renderInventory(items){
  const listEl = qs('#inventoryList');
  if(!listEl) return;
  listEl.innerHTML = '';
  let totalValue=0, totalRevenue=0, totalStock=0;
  items.forEach(it=>{
    const qty = Number(it.quantity||0);
    const uc = Number(it.unitCost||0);
    const up = Number(it.unitPrice||0);
    const invVal = qty * uc;
    totalValue += invVal; totalRevenue += qty * up; totalStock += qty;
    const row = document.createElement('tr');
    row.dataset.id = it.id;
    if(qty===0) row.classList.add('out-of-stock-row'); else if(qty<10) row.classList.add('low-stock-row');
    row.innerHTML = `
      <td>${escapeHtml(it.sku||'')}</td>
      <td>${escapeHtml(it.name||'')}</td>
      <td>${escapeHtml(it.category||'')}</td>
      <td>${qty}</td>
      <td class="money">RM ${uc.toFixed(2)}</td>
      <td class="money">RM ${up.toFixed(2)}</td>
      <td class="money">RM ${invVal.toFixed(2)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditPageForItem('${it.id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="confirmAndDeleteItem('${it.id}')">🗑️ Delete</button>
      </td>
    `;
    listEl.appendChild(row);
  });
  if(qs('#totalValue')) qs('#totalValue').textContent = totalValue.toFixed(2);
  if(qs('#totalRevenue')) qs('#totalRevenue').textContent = totalRevenue.toFixed(2);
  if(qs('#totalStock')) qs('#totalStock').textContent = totalStock;
  // update chart if present
  renderInventoryChart(items);
}

function renderDocuments(docs){
  const listEl = qs('#docList'); if(!listEl) return;
  listEl.innerHTML = '';
  docs.forEach(d=>{
    const sizeMB = ((d.sizeBytes || d.size || 0)/(1024*1024)).toFixed(2);
    const row = document.createElement('tr');
    row.dataset.id = d.id;
    row.innerHTML = `
      <td>${escapeHtml(d.name)}</td>
      <td>${sizeMB} MB</td>
      <td>${new Date(d.date).toLocaleString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="downloadDocument('${encodeURIComponent(d.name)}')">⬇️ Download</button>
        <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${d.id}')">🗑️ Delete</button>
      </td>
    `;
    listEl.appendChild(row);
  });
}

function renderLogs(){
  const listEl = qs('#logList'); if(!listEl) return;
  listEl.innerHTML = '';
  [...activityLog].forEach(l=>{
    const li = document.createElement('li');
    // l.time is ISO from server — format to local string
    let timeStr = '';
    try { timeStr = new Date(l.time).toLocaleString(); } catch(e){ timeStr = l.time; }
    li.innerHTML = `[${escapeHtml(timeStr)}] <b>${escapeHtml(l.user)}</b>: ${escapeHtml(l.action)}`;
    listEl.appendChild(li);
  });
  renderDashboardData();
}

function renderDashboardData(){
  const tbody = qs('#recentActivities');
  if(tbody){
    tbody.innerHTML = '';
    activityLog.slice(0,5).forEach(l=>{
      const tr = document.createElement('tr');
      let timeStr = '';
      try { timeStr = new Date(l.time).toLocaleString(); } catch(e){ timeStr = l.time; }
      tr.innerHTML = `<td>${escapeHtml(l.user||'Admin')}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(timeStr)}</td>`;
      tbody.appendChild(tr);
    });
  }
  if(qs('#dash_totalItems')){
    let tV=0,tR=0,tS=0;
    inventory.forEach(it => { const q=Number(it.quantity||0); tV += q*Number(it.unitCost||0); tR += q*Number(it.unitPrice||0); tS += q; });
    qs('#dash_totalItems').textContent = inventory.length;
    qs('#dash_totalValue').textContent = tV.toFixed(2);
    qs('#dash_totalRevenue').textContent = tR.toFixed(2);
    qs('#dash_totalStock').textContent = tS;
  }
}

// Inventory Chart: optional — requires Chart.js included in HTML pages
let inventoryChartInstance = null;
function renderInventoryChart(items){
  const canvas = qs('#inventoryChart');
  if(!canvas) return;
  // prepare labels and data (top 10 by quantity)
  const sorted = items.slice().sort((a,b)=> (b.quantity||0) - (a.quantity||0)).slice(0,10);
  const labels = sorted.map(i => i.name || i.sku || i.id);
  const data = sorted.map(i => Number(i.quantity||0));
  // create/update Chart.js chart if available
  if(typeof Chart === 'undefined') {
    // Chart.js not loaded — show fallback text
    const fallback = qs('#inventoryChartFallback');
    if(fallback) fallback.textContent = 'Include Chart.js to view inventory chart.';
    return;
  }
  const ctx = canvas.getContext('2d');
  if(inventoryChartInstance) inventoryChartInstance.destroy();
  inventoryChartInstance = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Stock Qty', data }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });
}

// Data fetchers
async function fetchInventory(){ try {
  const res = await apiFetch(`${API_BASE}/inventory`);
  if(!res.ok) throw new Error('Failed to fetch inventory');
  inventory = await res.json();
  renderInventory(inventory);
} catch(e){ console.error('fetchInventory', e); } }

async function fetchDocuments(){ try {
  const res = await apiFetch(`${API_BASE}/documents`);
  if(!res.ok) throw new Error('Failed to fetch documents');
  documents = await res.json();
  renderDocuments(documents);
} catch(e){ console.error('fetchDocuments', e); } }

async function fetchLogs(){ try {
  const res = await apiFetch(`${API_BASE}/logs`);
  if(!res.ok) throw new Error('Failed to fetch logs');
  activityLog = await res.json();
  renderLogs();
} catch(e){ console.error('fetchLogs', e); } }

async function fetchSales(){ try {
  const res = await apiFetch(`${API_BASE}/sales`);
  if(!res.ok) throw new Error('Failed to fetch sales');
  sales = await res.json();
} catch(e){ console.error('fetchSales', e); } }

async function fetchOrders(){ try {
  const res = await apiFetch(`${API_BASE}/orders`);
  if(!res.ok) throw new Error('Failed to fetch orders');
  orders = await res.json();
} catch(e){ console.error('fetchOrders', e); } }

// Init on page load
window.addEventListener('load', async ()=>{
  const adminName = getUsername();
  if(qs('#adminName')) qs('#adminName').textContent = adminName;
  const theme = (window.CONFIG && CONFIG.LS_THEME) ? localStorage.getItem(CONFIG.LS_THEME) : null;
  if(theme === 'dark') document.body.classList.add('dark-mode');

  try {
    if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
    if(currentPage.includes('documents')) { await fetchDocuments(); bindDocumentsUI(); }
    if(currentPage.includes('log')) { await fetchLogs(); }
    if(currentPage === '' || currentPage === 'index.html' || currentPage.includes('index.html')) { await fetchLogs(); await fetchInventory(); }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
    // sales & orders used by dashboard/buttons
    await fetchSales(); await fetchOrders();
  } catch(e) { console.error('init error', e); }
});

// AUTH
async function login(){
  const user = qs('#username')?.value.trim();
  const pass = qs('#password')?.value.trim();
  const msg = qs('#loginMessage');
  showMsg(msg,'');
  if(!user||!pass){ showMsg(msg,'⚠️ Please enter username and password.','red'); return; }
  try {
    const res = await apiFetch(`${API_BASE}/login`, { method:'POST', body: JSON.stringify({ username:user, password:pass }) });
    const data = await res.json();
    if(res.ok){ sessionStorage.setItem('isLoggedIn','true'); sessionStorage.setItem('adminName', user); showMsg(msg,'✅ Login successful.','green'); setTimeout(()=>window.location.href='index.html',700); }
    else showMsg(msg, `❌ ${data.message||'Login failed'}`, 'red');
  } catch(e){ showMsg(msg, '❌ Server connection failed.','red'); }
}

async function register(){
  const user = qs('#newUsername')?.value.trim();
  const pass = qs('#newPassword')?.value.trim();
  const code = qs('#securityCode')?.value.trim();
  const msg = qs('#registerMessage');
  showMsg(msg,'');
  if(!user||!pass||!code){ showMsg(msg,'⚠️ Please fill in all fields.','red'); return; }
  try {
    const res = await apiFetch(`${API_BASE}/register`, { method:'POST', body: JSON.stringify({ username:user, password:pass, securityCode:code }) });
    const data = await res.json();
    if(res.ok) { showMsg(msg, '✅ Registered successfully! Please login.', 'green'); setTimeout(toggleForm, 900); }
    else showMsg(msg, `❌ ${data.message||'Registration failed'}`, 'red');
  } catch(e) { showMsg(msg, '❌ Server connection failed.','red'); }
}

function toggleForm(){
  const lf = qs('#loginForm'), rf = qs('#registerForm'), ft = qs('#formTitle');
  if(!lf||!rf||!ft) return;
  if(getComputedStyle(lf).display==='none'){ lf.style.display='block'; rf.style.display='none'; ft.textContent='🔐 Admin Login'; }
  else { lf.style.display='none'; rf.style.display='block'; ft.textContent='🧾 Register Account'; }
}

// INVENTORY CRUD
async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value.trim();
  const name = qs('#p_name')?.value.trim();
  const category = qs('#p_category')?.value.trim();
  const quantity = Number(qs('#p_quantity')?.value || 0);
  const unitCost = Number(qs('#p_unitCost')?.value || 0);
  const unitPrice = Number(qs('#p_unitPrice')?.value || 0);
  if(!sku||!name) return alert('Please enter SKU and Name.');
  if(!confirm(`Add product ${name} (${sku})?`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory`, { method:'POST', body: JSON.stringify({ sku,name,category,quantity,unitCost,unitPrice }) });
    if(res.ok){ await fetchInventory(); if(currentPage.includes('inventory')) await fetchLogs(); alert('✅ Product added'); }
    else { const d = await res.json(); alert('❌ Add failed: ' + (d.message||'Unknown')); }
  } catch(e){ console.error(e); alert('❌ Server error while adding product.'); }
}

async function confirmAndDeleteItem(id){
  const item = inventory.find(x => String(x.id) === String(id));
  if(!item) return;
  if(!confirm(`Delete "${item.name}"?`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method:'DELETE' });
    if(res.status===204){ await fetchInventory(); alert('🗑️ Item deleted'); }
    else { const d = await res.json(); alert('❌ Delete failed: ' + (d.message||'Unknown')); }
  } catch(e){ console.error(e); alert('❌ Server error while deleting product.'); }
}

async function confirmAndGenerateReport(){
  if(!confirm('Generate Inventory Excel report?')) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory/report`, { method:'GET' });
    if(res.ok){
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition');
      const fn = cd ? (cd.match(/filename="(.+?)"/) || [])[1] : `Inventory_Report_${Date.now()}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = fn; a.style.display='none'; document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
      await fetchDocuments(); alert('✅ Report generated and downloaded.');
    } else { const err = await res.json(); alert('❌ ' + (err.message||'Report failed')); }
  } catch(e){ console.error(e); alert('❌ Report generation error'); }
}

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport);
  qs('#searchInput')?.addEventListener('input', searchInventory);
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { if(qs('#searchInput')) { qs('#searchInput').value=''; searchInventory(); }});
}
function searchInventory(){
  const q = (qs('#searchInput')?.value||'').toLowerCase().trim();
  renderInventory(inventory.filter(i => (i.sku||'').toLowerCase().includes(q) || (i.name||'').toLowerCase().includes(q) || (i.category||'').toLowerCase().includes(q)));
}

// PRODUCT PAGE (edit)
function openEditPageForItem(id){ window.location.href = `product.html?id=${encodeURIComponent(id)}`; }

async function bindProductPage(){
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if(id){
    try {
      const res = await apiFetch(`${API_BASE}/inventory`);
      const items = await res.json();
      const it = items.find(x => String(x.id) === String(id));
      if(!it) { alert('Item not found'); return; }
      if(qs('#prod_id')) qs('#prod_id').value = it.id;
      if(qs('#prod_sku')) qs('#prod_sku').value = it.sku || '';
      if(qs('#prod_name')) qs('#prod_name').value = it.name || '';
      if(qs('#prod_category')) qs('#prod_category').value = it.category || '';
      if(qs('#prod_quantity')) qs('#prod_quantity').value = it.quantity || 0;
      if(qs('#prod_unitCost')) qs('#prod_unitCost').value = it.unitCost || 0;
      if(qs('#prod_unitPrice')) qs('#prod_unitPrice').value = it.unitPrice || 0;
    } catch(e){ console.error(e); alert('Failed to load product details.'); return; }
  }

  qs('#saveProductBtn')?.addEventListener('click', async ()=>{
    if(!confirm('Save changes?')) return;
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
      const res = await apiFetch(`${API_BASE}/inventory/${idVal}`, { method:'PUT', body: JSON.stringify(body) });
      if(res.ok){ alert('✅ Item updated'); window.location.href='inventory.html'; }
      else { const d = await res.json(); alert('❌ Update failed: ' + (d.message||'Unknown')); }
    } catch(e){ console.error(e); alert('❌ Server error during update'); }
  });

  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href = 'inventory.html');
}

// DOCUMENTS
async function uploadDocuments(){
  const files = qs('#docUpload')?.files || [];
  let msgEl = qs('#uploadMessage');
  if(!msgEl){ msgEl = document.createElement('p'); msgEl.id='uploadMessage'; if(qs('.controls')) qs('.controls').appendChild(msgEl); }
  if(files.length===0){ showMsg(msgEl,'⚠️ Please select files to upload.','red'); return; }
  if(!confirm(`Upload metadata for ${files.length} document(s)?`)) { showMsg(msgEl,'Upload cancelled.','orange'); return; }
  showMsg(msgEl, `Uploading ${files.length} document(s)...`, 'orange');
  for(let file of files){
    const docMetadata = { name:file.name, type:file.type, sizeBytes:file.size };
    try {
      const res = await apiFetch(`${API_BASE}/documents`, { method:'POST', body: JSON.stringify(docMetadata) });
      if(!res.ok) throw new Error('Server error');
      showMsg(msgEl, `✅ Uploaded ${file.name}`, 'green');
    } catch(e){ console.error(e); showMsg(msgEl, `❌ Failed ${file.name}`, 'red'); return; }
  }
  if(qs('#docUpload')) qs('#docUpload').value = '';
  setTimeout(async ()=>{ await fetchDocuments(); if(msgEl) msgEl.remove(); }, 800);
}

function downloadDocument(encName){
  const name = decodeURIComponent(encName);
  if(!confirm(`Download ${name}?`)) return;
  window.open(`${API_BASE}/documents/download/${encodeURIComponent(name)}`, '_blank');
}

async function deleteDocumentConfirm(id){
  const doc = documents.find(d => String(d.id) === String(id));
  if(!doc) return;
  if(!confirm(`Delete document metadata: ${doc.name}?`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/documents/${id}`, { method:'DELETE' });
    if(res.status===204 || res.ok){ await fetchDocuments(); alert('🗑️ Document metadata deleted'); }
    else { const d = await res.json(); alert('❌ Delete failed: ' + (d.message||'Unknown')); }
  } catch(e){ console.error(e); alert('❌ Server error while deleting document'); }
}

function bindDocumentsUI(){
  qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments);
  qs('#searchDocs')?.addEventListener('input', searchDocuments);
}
function searchDocuments(){
  const q = (qs('#searchDocs')?.value||'').toLowerCase().trim();
  renderDocuments(documents.filter(d => (d.name||'').toLowerCase().includes(q) || (d.date? new Date(d.date).toLocaleString().toLowerCase() : '').includes(q)));
}

// SETTINGS
function bindSettingPage(){
  const current = getUsername();
  if(qs('#currentUser')) qs('#currentUser').textContent = current;
  qs('#changePasswordBtn')?.addEventListener('click', async ()=>{
    const newPass = qs('#newPassword')?.value; const conf = qs('#confirmPassword')?.value; const code = qs('#securityCode')?.value; const msgEl = qs('#passwordMessage');
    showMsg(msgEl,'');
    if(!newPass||!conf||!code) return showMsg(msgEl,'⚠️ Please fill in all fields.','red');
    if(newPass !== conf) return showMsg(msgEl,'⚠️ Passwords do not match.','red');
    if(!confirm('Confirm password change? You will be logged out.')) return;
    try {
      const res = await apiFetch(`${API_BASE}/account/password`, { method:'PUT', body: JSON.stringify({ username: current, newPassword: newPass, securityCode: code }) });
      const d = await res.json();
      if(res.ok){ showMsg(msgEl,'✅ Password updated. Logging out...','green'); setTimeout(logout,1500); }
      else showMsg(msgEl, `❌ ${d.message||'Failed'}`, 'red');
    } catch(e){ showMsg(msgEl, '❌ Server error', 'red'); }
  });

  qs('#deleteAccountBtn')?.addEventListener('click', async ()=>{
    if(!confirm('Are you sure you want to delete your account?')) return;
    const code = prompt('Enter Admin Security Code:');
    if(!code) return alert('Cancelled');
    try {
      const res = await apiFetch(`${API_BASE}/account`, { method:'DELETE', body: JSON.stringify({ username: current, securityCode: code }) });
      const d = await res.json();
      if(res.ok) { alert('🗑️ Account deleted'); logout(); }
      else alert('❌ ' + (d.message||'Failed'));
    } catch(e){ alert('❌ Server error'); }
  });
}

// SALES & ORDERS: report downloads
async function downloadSalesReportXLSX(){
  if(!confirm('Download Sales Excel report?')) return;
  try {
    const res = await apiFetch(`${API_BASE}/sales/report`, { method:'GET' });
    if(res.ok){
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition');
      const fn = cd ? (cd.match(/filename="(.+?)"/)||[])[1] : `Sales_Report_${Date.now()}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=fn; a.click(); a.remove(); window.URL.revokeObjectURL(url);
      await fetchDocuments(); alert('✅ Sales report downloaded.');
    } else { const d = await res.json(); alert('❌ ' + (d.message||'Report failed')); }
  } catch(e){ console.error(e); alert('❌ Sales report error'); }
}
async function downloadOrdersReportXLSX(){
  if(!confirm('Download Orders Excel report?')) return;
  try {
    const res = await apiFetch(`${API_BASE}/orders/report`, { method:'GET' });
    if(res.ok){
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition');
      const fn = cd ? (cd.match(/filename="(.+?)"/)||[])[1] : `Orders_Report_${Date.now()}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=fn; a.click(); a.remove(); window.URL.revokeObjectURL(url);
      await fetchDocuments(); alert('✅ Orders report downloaded.');
    } else { const d = await res.json(); alert('❌ ' + (d.message||'Report failed')); }
  } catch(e){ console.error(e); alert('❌ Orders report error'); }
}

// Event bindings
document.addEventListener('DOMContentLoaded', ()=>{
  if(currentPage.includes('login.html')){
    qs('#loginBtn')?.addEventListener('click', login);
    qs('#registerBtn')?.addEventListener('click', register);
    qs('#toggleToRegister')?.addEventListener('click', toggleForm);
    qs('#toggleToLogin')?.addEventListener('click', toggleForm);
  }

  // optional buttons on all pages
  qs('#downloadSalesXLSXBtn')?.addEventListener('click', downloadSalesReportXLSX);
  qs('#downloadOrdersXLSXBtn')?.addEventListener('click', downloadOrdersReportXLSX);
});

// expose some functions to inline onclick attributes
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;
window.downloadSalesReportXLSX = downloadSalesReportXLSX;
window.downloadOrdersReportXLSX = downloadOrdersReportXLSX;
