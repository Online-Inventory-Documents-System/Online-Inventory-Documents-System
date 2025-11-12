// public/js/script.js
// Complete client-side script for Online Inventory & Documents System
// Replace the API_BASE with your deployed domain

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api"; // Update for production

// ====== Utilities ======
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [];
let activityLog = [];
let documents = [];
const currentPage = window.location.pathname.split('/').pop();

// ====== API Fetch Wrapper ======
async function apiFetch(url, options = {}) {
  const user = getUsername();
  options.headers = {
      'Content-Type': 'application/json',
      'X-Username': user,
      ...options.headers
  };
  return fetch(url, options);
}

// ====== Auth Redirect ======
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')){
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

// ====== RENDERERS ======

// Inventory Table
function renderInventory(items){
  const listEl = qs('#inventoryList');
  if(!listEl) return;
  listEl.innerHTML = '';

  let totalValue = 0, totalRevenue = 0, totalStock = 0;

  items.forEach(item => {
      const id = item.id;
      const qty = Number(item.quantity || 0);
      const uc = Number(item.unitCost || 0);
      const up = Number(item.unitPrice || 0);
      const invVal = qty * uc;
      const rev = qty * up;

      totalValue += invVal;
      totalRevenue += rev;
      totalStock += qty;

      const row = document.createElement('tr');
      row.dataset.id = id;

      if(qty === 0) row.classList.add('out-of-stock-row');
      else if(qty < 10) row.classList.add('low-stock-row');

      row.innerHTML = `
          <td>${escapeHtml(item.sku)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.category)}</td>
          <td>${qty}</td>
          <td class="money">RM ${uc.toFixed(2)}</td>
          <td class="money">RM ${up.toFixed(2)}</td>
          <td class="money">RM ${invVal.toFixed(2)}</td>
          <td class="actions">
            <button class="primary-btn small-btn" onclick="openEditPageForItem('${id}')">✏️ Edit</button>
            <button class="danger-btn small-btn" onclick="confirmAndDeleteItem('${id}')">🗑️ Delete</button>
          </td>
      `;
      listEl.appendChild(row);
  });

  if(qs('#totalValue')) qs('#totalValue').textContent = totalValue.toFixed(2);
  if(qs('#totalRevenue')) qs('#totalRevenue').textContent = totalRevenue.toFixed(2);
  if(qs('#totalStock')) qs('#totalStock').textContent = totalStock;
}

// Documents Table
function renderDocuments(docs){
  const listEl = qs('#docList');
  if(!listEl) return;
  listEl.innerHTML = '';

  docs.forEach(doc => {
    const id = doc.id;
    const sizeMB = ((doc.sizeBytes || doc.size || 0) / (1024*1024)).toFixed(2);
    const row = document.createElement('tr');
    row.dataset.id = id;
    row.innerHTML = `
      <td>${escapeHtml(doc.name)}</td>
      <td>${sizeMB} MB</td>
      <td>${new Date(doc.date).toLocaleString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="downloadDocument('${encodeURIComponent(doc.name)}')">⬇️ Download</button>
        <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${id}')">🗑️ Delete</button>
      </td>
    `;
    listEl.appendChild(row);
  });
}

// Activity Log
function renderLogs(){
  const listEl = qs('#logList');
  if(!listEl) return;
  listEl.innerHTML = '';
  [...activityLog].reverse().forEach(log => {
    const item = document.createElement('li');
    item.innerHTML = `[${escapeHtml(log.time)}] <b>${escapeHtml(log.user)}</b>: ${escapeHtml(log.action)}`;
    listEl.appendChild(item);
  });
  renderDashboardData();
}

// Dashboard Stats
function renderDashboardData(){
  const tbody = qs('#recentActivities');
  if(tbody){
    tbody.innerHTML = '';
    activityLog.slice().reverse().slice(0,5).forEach(log=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(log.user||'Admin')}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.time)}</td>`;
      tbody.appendChild(tr);
    });
  }

  if(qs('#dash_totalItems')){
    let totalValue=0, totalRevenue=0, totalStock=0;
    inventory.forEach(item=>{
      const qty = Number(item.quantity||0);
      totalValue += qty * Number(item.unitCost||0);
      totalRevenue += qty * Number(item.unitPrice||0);
      totalStock += qty;
    });
    qs('#dash_totalItems').textContent = inventory.length;
    qs('#dash_totalValue').textContent = totalValue.toFixed(2);
    qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
    qs('#dash_totalStock').textContent = totalStock;
  }
}

// ====== DATA FETCHERS ======
async function fetchInventory(){ 
  try{
    const res = await apiFetch(`${API_BASE}/inventory`);
    if(!res.ok) throw new Error('Failed to fetch inventory');
    inventory = await res.json();
    renderInventory(inventory);
    renderDashboardData();
  } catch(e){ console.error('Fetch inventory error:', e); }
}

async function fetchDocuments(){ 
  try{
    const res = await apiFetch(`${API_BASE}/documents`);
    if(!res.ok) throw new Error('Failed to fetch documents');
    documents = await res.json();
    renderDocuments(documents);
  } catch(e){ console.error('Fetch documents error:', e); }
}

async function fetchLogs(){
  try{
    const res = await apiFetch(`${API_BASE}/logs`);
    if(!res.ok) throw new Error('Failed to fetch logs');
    activityLog = await res.json();
    renderLogs();
  } catch(e){ console.error('Fetch logs error:', e); }
}

// ====== INIT ======
window.addEventListener('load', async ()=>{
  const adminName = getUsername();
  if(qs('#adminName')) qs('#adminName').textContent = adminName;

  const theme = (window.CONFIG && CONFIG.LS_THEME) ? localStorage.getItem(CONFIG.LS_THEME) : null;
  if(theme==='dark') document.body.classList.add('dark-mode');

  try{
    if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
    if(currentPage.includes('documents')) { await fetchDocuments(); bindDocumentsUI(); }
    if(currentPage.includes('log') || currentPage === '' || currentPage==='index.html') { await fetchLogs(); await fetchInventory(); }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
  } catch(e){ console.error('Init error:', e); }
});

// ====== AUTH ======
async function login(){
  const user = qs('#username')?.value.trim();
  const pass = qs('#password')?.value.trim();
  const msg = qs('#loginMessage');
  showMsg(msg,'');
  if(!user||!pass){ showMsg(msg,'⚠️ Enter username and password'); return; }

  try{
    const res = await apiFetch(`${API_BASE}/login`, { method:'POST', body: JSON.stringify({username:user,password:pass}) });
    const data = await res.json();
    if(res.ok){
      sessionStorage.setItem('isLoggedIn','true');
      sessionStorage.setItem('adminName', user);
      showMsg(msg,'✅ Login successful','green');
      setTimeout(()=> window.location.href='index.html',700);
    } else {
      showMsg(msg,`❌ ${data.message||'Login failed'}`,'red');
    }
  } catch(e){ showMsg(msg,'❌ Server error','red'); }
}

async function register(){
  const user = qs('#newUsername')?.value.trim();
  const pass = qs('#newPassword')?.value.trim();
  const code = qs('#securityCode')?.value.trim();
  const msg = qs('#registerMessage');
  showMsg(msg,'');
  if(!user||!pass||!code){ showMsg(msg,'⚠️ Fill all fields','red'); return; }

  try{
    const res = await apiFetch(`${API_BASE}/register`, { method:'POST', body: JSON.stringify({username:user,password:pass,securityCode:code}) });
    const data = await res.json();
    if(res.ok){ showMsg(msg,'✅ Registered! Login now','green'); setTimeout(toggleForm,900); }
    else showMsg(msg,`❌ ${data.message||'Registration failed'}`,'red');
  } catch(e){ showMsg(msg,'❌ Server error','red'); }
}

function toggleForm(){
  const loginForm=qs('#loginForm'), registerForm=qs('#registerForm'), formTitle=qs('#formTitle');
  if(!loginForm||!registerForm||!formTitle) return;
  if(getComputedStyle(loginForm).display==='none'){
    loginForm.style.display='block'; registerForm.style.display='none'; formTitle.textContent='🔐 Admin Login';
  } else{
    loginForm.style.display='none'; registerForm.style.display='block'; formTitle.textContent='🧾 Register Account';
  }
}

// ====== INVENTORY CRUD ======
async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value.trim();
  const name = qs('#p_name')?.value.trim();
  const category = qs('#p_category')?.value.trim();
  const quantity = Number(qs('#p_quantity')?.value || 0);
  const unitCost = Number(qs('#p_unitCost')?.value || 0);
  const unitPrice = Number(qs('#p_unitPrice')?.value || 0);
  if(!sku||!name) return alert('Enter SKU and Name');
  if(!confirm(`Add Product: ${name} (${sku})?`)) return;
  
  const newItem = { sku,name,category,quantity,unitCost,unitPrice };
  try{
    const res = await apiFetch(`${API_BASE}/inventory`, { method:'POST', body: JSON.stringify(newItem) });
    if(res.ok){ ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id=>{ if(qs(id)) qs(id).value=''; }); await fetchInventory(); if(currentPage.includes('inventory')) await fetchLogs(); alert('✅ Product added'); }
    else alert('❌ Failed to add product');
  } catch(e){ console.error(e); alert('❌ Server error'); }
}

async function confirmAndDeleteItem(id){
  const item = inventory.find(x=>x.id===id);
  if(!item) return;
  if(!confirm(`Delete "${item.name}"?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method:'DELETE' });
    if(res.status===204){ await fetchInventory(); alert('🗑️ Item deleted'); }
    else alert('❌ Failed to delete item');
  } catch(e){ console.error(e); alert('❌ Server error'); }
}

async function confirmAndGenerateReport(){
  if(!confirm('Generate new Excel report?')) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/report`, { method:'GET' });
    if(res.ok){
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition');
      const fnMatch = cd ? cd.match(/filename="(.+?)"/) : null;
      const filename = fnMatch ? fnMatch[1] : `Inventory_Report_${Date.now()}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.style.display='none'; a.href=url; a.download=filename; document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(url); a.remove();
      await fetchDocuments(); alert(`Report "${filename}" generated!`);
    } else{
      const err = await res.json(); alert(`Failed: ${err.message}`);
    }
  } catch(e){ console.error(e); alert('❌ Report error'); }
}

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport);
  qs('#searchInput')?.addEventListener('input', searchInventory);
  qs('#clearSearchBtn')?.addEventListener('click', ()=>{ if(qs('#searchInput')) { qs('#searchInput').value=''; searchInventory(); }});
}

function searchInventory(){
  const query = (qs('#searchInput')?.value || '').toLowerCase().trim();
  const filtered = inventory.filter(item=> (item.sku||'').toLowerCase().includes(query) || (item.name||'').toLowerCase().includes(query) || (item.category||'').toLowerCase().includes(query));
  renderInventory(filtered);
}

// ====== PRODUCT PAGE ======
function openEditPageForItem(id){ window.location.href=`product.html?id=${encodeURIComponent(id)}`; }

async function bindProductPage(){
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if(id){
    try{
      const res = await apiFetch(`${API_BASE}/inventory`);
      const items = await res.json();
      const it = items.find(x=>String(x.id)===String(id));
      if(!it){ alert('Item not found'); return; }
      ['#prod_id','#prod_sku','#prod_name','#prod_category','#prod_quantity','#prod_unitCost','#prod_unitPrice'].forEach(idSelector=>{
        if(qs(idSelector)) qs(idSelector).value = it[idSelector.replace('#prod_','')] || 0;
      });
    } catch(e){ alert('Failed to load product'); return; }
  }

  qs('#saveProductBtn')?.addEventListener('click', async ()=>{
    if(!confirm('Save changes?')) return;
    const idVal = qs('#prod_id')?.value;
    const body = {
      sku: qs('#prod_sku')?.value,
      name: qs('#prod_name')?.value,
      category: qs('#prod_category')?.value,
      quantity: Number(qs('#prod_quantity')?.value||0),
      unitCost: Number(qs('#prod_unitCost')?.value||0),
      unitPrice: Number(qs('#prod_unitPrice')?.value||0)
    };
    try{
      const res = await apiFetch(`${API_BASE}/inventory/${idVal}`, { method:'PUT', body: JSON.stringify(body) });
      if(res.ok){ alert('✅ Item updated'); window.location.href='inventory.html'; }
      else alert('❌ Update failed');
    } catch(e){ console.error(e); alert('❌ Server error'); }
  });

  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href='inventory.html');
}

// ====== DOCUMENTS ======
async function uploadDocuments(){
  const files = qs('#docUpload')?.files || [];
  let msgEl = qs('#uploadMessage');
  if(!msgEl){ msgEl = document.createElement('p'); msgEl.id='uploadMessage'; if(qs('.controls')) qs('.controls').appendChild(msgEl); }

  if(files.length===0){ showMsg(msgEl,'⚠️ Select files','red'); return; }
  if(!confirm(`Upload metadata for ${files.length} document(s)?`)){ showMsg(msgEl,'Cancelled','orange'); return; }
  showMsg(msgEl,`Uploading ${files.length} document(s)...`,'orange');

  for(let file of files){
    const docMetadata = { name:file.name, type:file.type, sizeBytes:file.size };
    try{
      const res = await apiFetch(`${API_BASE}/documents`, { method:'POST', body: JSON.stringify(docMetadata) });
      if(!res.ok) throw new Error('Server error');
      showMsg(msgEl,`✅ Uploaded ${file.name}`,'green');
    } catch(e){ console.error(e); showMsg(msgEl,`❌ Failed ${file.name}`,'red'); return; }
  }

  if(qs('#docUpload')) qs('#docUpload').value='';
  setTimeout(async ()=>{ await fetchDocuments(); if(msgEl) msgEl.remove(); },1000);
}

function downloadDocument(fileNameEncoded){ const fileName = decodeURIComponent(fileNameEncoded); if(!confirm(`Download: ${fileName}?`)) return; window.open(`${API_BASE}/documents/download/${encodeURIComponent(fileName)}`,'_blank'); }

async function deleteDocumentConfirm(id){
  const doc = documents.find(d=>String(d.id)===String(id));
  if(!doc) return;
  if(confirm(`Delete document metadata for "${doc.name}"?`)) await deleteDocument(id);
}

async function deleteDocument(id){
  try{
    const res = await apiFetch(`${API_BASE}/documents/${id}`, { method:'DELETE' });
    if(res.status===204 || res.ok){ await fetchDocuments(); alert('🗑️ Document deleted'); }
    else alert('❌ Delete failed');
  } catch(e){ console.error(e); alert('❌ Server error'); }
}

function searchDocuments(){
  const query = (qs('#searchDocs')?.value||'').toLowerCase().trim();
  const filtered = documents.filter(doc=> (doc.name||'').toLowerCase().includes(query) || (doc.date?new Date(doc.date).toLocaleString().toLowerCase():'').includes(query));
  renderDocuments(filtered);
}

function bindDocumentsUI(){
  qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments);
  qs('#searchDocs')?.addEventListener('input', searchDocuments);
}

// ====== SETTINGS ======
function bindSettingPage(){
  const currentUsername = getUsername();
  if(qs('#currentUser')) qs('#currentUser').textContent = currentUsername;

  qs('#changePasswordBtn')?.addEventListener('click', async ()=>{
    const newPass = qs('#newPassword')?.value;
    const confPass = qs('#confirmPassword')?.value;
    const code = qs('#securityCode')?.value;
    const msgEl = qs('#passwordMessage');
    showMsg(msgEl,'');
    if(!newPass||!confPass||!code){ return showMsg(msgEl,'⚠️ Fill all fields','red'); }
    if(newPass!==confPass){ return showMsg(msgEl,'⚠️ Passwords do not match','red'); }
    if(!confirm('Change password? You will be logged out after.')) return;

    try{
      const res = await apiFetch(`${API_BASE}/account/password`, { method:'PUT', body: JSON.stringify({ username:currentUsername,newPassword:newPass,securityCode:code }) });
      const data = await res.json();
      if(res.ok){ showMsg(msgEl,'✅ Password updated. Logging out','green'); setTimeout(logout,1500); }
      else showMsg(msgEl,`❌ ${data.message||'Failed'}`,'red');
    } catch(e){ showMsg(msgEl,'❌ Server error','red'); }
  });

  qs('#deleteAccountBtn')?.addEventListener('click', async ()=>{
    if(!confirm(`Delete account for "${currentUsername}"?`)) return;
    const code = prompt('Enter Admin Security Code:');
    if(!code) return alert('Cancelled');

    try{
      const res = await apiFetch(`${API_BASE}/account`, { method:'DELETE', body: JSON.stringify({ username:currentUsername,securityCode:code }) });
      const data = await res.json();
      if(res.ok){ alert('🗑️ Account deleted'); logout(); }
      else alert(`❌ ${data.message||'Failed'}`);
    } catch(e){ alert('❌ Server error'); }
  });
}

// ====== Event bindings ======
document.addEventListener('DOMContentLoaded', ()=>{
  if(currentPage.includes('login.html')){
    qs('#loginBtn')?.addEventListener('click', login);
    qs('#registerBtn')?.addEventListener('click', register);
    qs('#toggleToRegister')?.addEventListener('click', toggleForm);
    qs('#toggleToLogin')?.addEventListener('click', toggleForm);
  }
});

// ====== Expose globals ======
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;
