// public/js/script.js
// Unified client script: inventory, documents, sales, orders, logs, settings
// API_BASE - change to your deployed API if needed
const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [], sales = [], orders = [], documents = [], activityLog = [];
const currentPage = window.location.pathname.split('/').pop();

// ---------------- API wrapper ----------------
async function apiFetch(url, options = {}) {
  const user = getUsername();
  options.headers = {
    'Content-Type': 'application/json',
    'X-Username': user,
    ...options.headers
  };
  return fetch(url, options);
}

// ---------------- Auth redirect ----------------
// Only redirect to login if not on login page
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  try { window.location.href = 'login.html'; } catch(e) {}
}

function logout(){
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('adminName');
  window.location.href = 'login.html';
}

function toggleTheme(){
  document.body.classList.toggle('dark-mode');
  if(window.CONFIG && CONFIG.LS_THEME) {
    localStorage.setItem(CONFIG.LS_THEME, document.body.classList.contains('dark-mode') ? 'dark' : 'light');
  }
}

// ---------------- RENDERERS ----------------

function renderInventory(items){
  const list = qs('#inventoryList'); if(!list) return;
  list.innerHTML = '';
  let totalValue = 0, totalRevenue = 0, totalStock = 0;

  items.forEach(it=>{
    const id = it.id || it._id;
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const invVal = qty * uc;
    const rev = qty * up;
    totalValue += invVal; totalRevenue += rev; totalStock += qty;

    const tr = document.createElement('tr');
    if(qty === 0) tr.classList.add('out-of-stock-row');
    else if(qty < 10) tr.classList.add('low-stock-row');

    tr.dataset.id = id;
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

function renderSales(rows){
  const t = qs('#salesList'); if(!t) return;
  t.innerHTML = '';
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(r.invoice||'')}</td><td>${escapeHtml(r.product||'')}</td><td>${Number(r.quantity||0)}</td><td class="money">RM ${(Number(r.total)||0).toFixed(2)}</td><td>${new Date(r.date||r.createdAt||Date.now()).toLocaleString()}</td>`;
    t.appendChild(tr);
  });
}

function renderOrders(rows){
  const t = qs('#ordersList'); if(!t) return;
  t.innerHTML = '';
  rows.forEach(o=>{
    const itemsSummary = Array.isArray(o.items) ? o.items.map(i=> `${escapeHtml(i.name||i.sku||'')} x${i.qty}`).join(', ') : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(o.orderNumber||o._id)}</td><td>${escapeHtml(o.customerName||'')}</td><td>${itemsSummary}</td><td class="money">RM ${(Number(o.total)||0).toFixed(2)}</td><td>${escapeHtml(o.status||'')}</td><td>${new Date(o.date||o.createdAt||Date.now()).toLocaleString()}</td>`;
    t.appendChild(tr);
  });
}

function renderDocuments(docs){
  const list = qs('#docList'); if(!list) return;
  list.innerHTML = '';
  docs.forEach(d=>{
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

function renderLogs(){
  const list = qs('#logList'); if(!list) return;
  list.innerHTML = '';
  (activityLog || []).slice(0,500).forEach(l=>{
    const timeStr = l.time ? new Date(l.time).toLocaleString() : new Date().toLocaleString();
    const li = document.createElement('li');
    li.innerHTML = `[${escapeHtml(timeStr)}] <b>${escapeHtml(l.user||'System')}</b>: ${escapeHtml(l.action||'')}`;
    list.appendChild(li);
  });
  renderDashboardData();
}

// Dashboard summary & small recent activities table
function renderDashboardData(){
  // summary stats
  if(qs('#dash_totalItems')){
    const totalItems = inventory.length;
    let totalValue=0, totalRevenue=0, totalStock=0;
    inventory.forEach(i=>{
      const q = Number(i.quantity||0);
      totalValue += q * Number(i.unitCost||0);
      totalRevenue += q * Number(i.unitPrice||0);
      totalStock += q;
    });
    qs('#dash_totalItems').textContent = totalItems;
    qs('#dash_totalValue').textContent = totalValue.toFixed(2);
    qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
    qs('#dash_totalStock').textContent = totalStock;
  }

  // recent activities small table
  const tbody = qs('#recentActivities');
  if(tbody){
    tbody.innerHTML = '';
    (activityLog || []).slice(0,5).forEach(l=>{
      const tr = document.createElement('tr');
      const timeStr = l.time ? new Date(l.time).toLocaleString() : new Date().toLocaleString();
      tr.innerHTML = `<td>${escapeHtml(l.user||'Admin')}</td><td>${escapeHtml(l.action||'')}</td><td>${escapeHtml(timeStr)}</td>`;
      tbody.appendChild(tr);
    });
  }
}

// ---------------- FETCHERS ----------------

async function fetchInventory(){
  try{
    const res = await apiFetch(`${API_BASE}/inventory`);
    if(!res.ok) throw new Error('Fetch inventory failed');
    const data = await res.json();
    inventory = data.map(i => ({ ...i, id: i.id || i._id }));
    renderInventory(inventory);
    renderDashboardData();
  }catch(e){ console.error('fetchInventory', e); }
}

async function fetchSales(){
  try{
    const res = await apiFetch(`${API_BASE}/sales`);
    if(!res.ok) throw new Error('Fetch sales failed');
    sales = await res.json();
    renderSales(sales);
  }catch(e){ console.error('fetchSales', e); }
}

async function fetchOrders(){
  try{
    const res = await apiFetch(`${API_BASE}/orders`);
    if(!res.ok) throw new Error('Fetch orders failed');
    orders = await res.json();
    renderOrders(orders);
  }catch(e){ console.error('fetchOrders', e); }
}

async function fetchDocuments(){
  try{
    const res = await apiFetch(`${API_BASE}/documents`);
    if(!res.ok) throw new Error('Fetch documents failed');
    documents = await res.json();
    renderDocuments(documents);
  }catch(e){ console.error('fetchDocuments', e); }
}

async function fetchLogs(){
  try{
    const res = await apiFetch(`${API_BASE}/logs`);
    if(!res.ok) throw new Error('Fetch logs failed');
    activityLog = await res.json();
    renderLogs();
  }catch(e){ console.error('fetchLogs', e); }
}

// ---------------- INIT ----------------
window.addEventListener('load', async ()=>{
  // show admin name
  if(qs('#adminName')) qs('#adminName').textContent = getUsername();

  // theme from CONFIG if present
  if(window.CONFIG && CONFIG.LS_THEME && localStorage.getItem(CONFIG.LS_THEME) === 'dark') document.body.classList.add('dark-mode');

  try{
    if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
    if(currentPage.includes('sales')) { await fetchInventory(); await fetchSales(); bindSalesUI(); }
    if(currentPage.includes('orders')) { await fetchInventory(); await fetchOrders(); bindOrdersUI(); }
    if(currentPage.includes('documents')) { await fetchDocuments(); bindDocumentsUI(); }
    if(currentPage.includes('log') || currentPage==='' || currentPage==='index.html') { await fetchLogs(); await fetchInventory(); }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
  }catch(e){ console.error('init error', e); }
});

// ---------------- AUTH (login/register) ----------------

async function login(){
  const user = qs('#username')?.value?.trim();
  const pass = qs('#password')?.value?.trim();
  const msg = qs('#loginMessage');
  showMsg(msg,'');
  if(!user || !pass){ showMsg(msg,'⚠️ Enter username & password','red'); return; }

  try{
    const res = await apiFetch(`${API_BASE}/login`, { method:'POST', body: JSON.stringify({ username: user, password: pass }) });
    const data = await res.json();
    if(res.ok){ sessionStorage.setItem('isLoggedIn','true'); sessionStorage.setItem('adminName', user); showMsg(msg,'✅ Login successful','green'); setTimeout(()=> window.location.href='index.html',600); }
    else showMsg(msg, `❌ ${data.message||'Login failed'}`,'red');
  }catch(e){ showMsg(msg,'❌ Server error','red'); console.error(e); }
}

async function register(){
  const user = qs('#newUsername')?.value?.trim();
  const pass = qs('#newPassword')?.value?.trim();
  const code = qs('#securityCode')?.value?.trim();
  const msg = qs('#registerMessage');
  showMsg(msg,'');
  if(!user||!pass||!code){ showMsg(msg,'⚠️ Fill all fields','red'); return; }
  try{
    const res = await apiFetch(`${API_BASE}/register`, { method:'POST', body: JSON.stringify({ username:user, password:pass, securityCode:code }) });
    const data = await res.json();
    if(res.ok){ showMsg(msg,'✅ Registered. Please login','green'); setTimeout(()=> toggleForm(),900); } else showMsg(msg, `❌ ${data.message||'Register failed'}`,'red');
  }catch(e){ showMsg(msg,'❌ Server error','red'); console.error(e); }
}

function toggleForm(){
  const loginForm=qs('#loginForm'), registerForm=qs('#registerForm'), formTitle=qs('#formTitle');
  if(!loginForm||!registerForm||!formTitle) return;
  if(getComputedStyle(loginForm).display==='none'){
    loginForm.style.display='block'; registerForm.style.display='none'; formTitle.textContent='🔐 Admin Login';
  } else {
    loginForm.style.display='none'; registerForm.style.display='block'; formTitle.textContent='🧾 Register Account';
  }
}

// ---------------- INVENTORY CRUD ----------------

async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value?.trim();
  const name = qs('#p_name')?.value?.trim();
  const category = qs('#p_category')?.value?.trim();
  const quantity = Number(qs('#p_quantity')?.value || 0);
  const unitCost = Number(qs('#p_unitCost')?.value || 0);
  const unitPrice = Number(qs('#p_unitPrice')?.value || 0);
  if(!sku || !name) return alert('Enter SKU and name');
  if(!confirm(`Add product ${name}?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory`, { method:'POST', body: JSON.stringify({ sku,name,category,quantity,unitCost,unitPrice }) });
    if(res.ok){ await fetchInventory(); alert('Product added'); ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id=> qs(id) && (qs(id).value='')); }
    else { const err = await res.json(); alert('Add failed: ' + (err.message||'')); }
  }catch(e){ console.error(e); alert('Server error'); }
}

async function confirmAndDeleteItem(id){
  const it = inventory.find(x => String(x.id) === String(id));
  if(!it) return;
  if(!confirm(`Delete ${it.name}?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method:'DELETE' });
    if(res.status === 204){ await fetchInventory(); alert('Deleted'); }
    else { const err = await res.json(); alert('Delete failed: ' + (err.message||'')); }
  }catch(e){ console.error(e); alert('Server error'); }
}

async function confirmAndGenerateReport(){
  if(!confirm('Generate inventory Excel?')) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    const filenameMatch = cd ? cd.match(/filename="(.+?)"/) : null;
    const filename = filenameMatch ? filenameMatch[1] : `Inventory_Report_${Date.now()}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchDocuments();
    alert('Report downloaded');
  }catch(e){ console.error(e); alert('Error'); }
}

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport);
  qs('#searchInput')?.addEventListener('input', ()=> {
    const q = (qs('#searchInput')?.value||'').toLowerCase();
    renderInventory(inventory.filter(i=> (i.sku||'').toLowerCase().includes(q) || (i.name||'').toLowerCase().includes(q) || (i.category||'').toLowerCase().includes(q)));
  });
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { if(qs('#searchInput')) { qs('#searchInput').value=''; renderInventory(inventory); } });
}

// ---------------- PRODUCT PAGE ----------------

function openEditPageForItem(id){ window.location.href = `product.html?id=${encodeURIComponent(id)}`; }

async function bindProductPage(){
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if(id){
    try{
      const res = await apiFetch(`${API_BASE}/inventory`);
      if(!res.ok) throw new Error();
      const items = await res.json();
      const it = items.find(x=>String(x.id)===String(id));
      if(!it) { alert('Item not found'); return; }
      qs('#prod_id') && (qs('#prod_id').value = it.id || it._id);
      qs('#prod_sku') && (qs('#prod_sku').value = it.sku || '');
      qs('#prod_name') && (qs('#prod_name').value = it.name || '');
      qs('#prod_category') && (qs('#prod_category').value = it.category || '');
      qs('#prod_quantity') && (qs('#prod_quantity').value = it.quantity || 0);
      qs('#prod_unitCost') && (qs('#prod_unitCost').value = it.unitCost || 0);
      qs('#prod_unitPrice') && (qs('#prod_unitPrice').value = it.unitPrice || 0);
    }catch(e){ console.error(e); alert('Load failed'); }
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
      if(res.ok){ alert('Updated'); window.location.href='inventory.html'; }
      else { const err = await res.json(); alert('Update failed: ' + (err.message||'')); }
    }catch(e){ console.error(e); alert('Server error'); }
  });
  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href='inventory.html');
}

// ---------------- DOCUMENTS ----------------
async function uploadDocuments(){
  const files = qs('#docUpload')?.files || [];
  if(files.length === 0) return showMsg(qs('#uploadMessage'), '⚠️ Select files', 'red');
  if(!confirm(`Upload metadata for ${files.length} file(s)?`)) return;
  for(const f of files){
    try{
      const res = await apiFetch(`${API_BASE}/documents`, { method:'POST', body: JSON.stringify({ name: f.name, sizeBytes: f.size, type: f.type }) });
      if(!res.ok) throw new Error('Upload failed');
    }catch(e){ console.error(e); showMsg(qs('#uploadMessage'), `❌ Failed ${f.name}`); return; }
  }
  qs('#docUpload').value = '';
  setTimeout(()=> fetchDocuments(), 800);
  showMsg(qs('#uploadMessage'), 'Uploaded', 'green');
}

function downloadDocument(encodedName){
  const name = decodeURIComponent(encodedName);
  if(!confirm(`Download ${name}?`)) return;
  window.open(`${API_BASE}/documents/download/${encodeURIComponent(name)}`, '_blank');
}

async function deleteDocumentConfirm(id){
  const d = documents.find(x=>String(x.id)===String(id));
  if(!d) return;
  if(!confirm(`Delete ${d.name}?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/documents/${id}`, { method:'DELETE' });
    if(res.status === 204){ await fetchDocuments(); alert('Deleted'); }
    else { const err = await res.json(); alert('Failed: ' + (err.message||'')); }
  }catch(e){ console.error(e); alert('Server error'); }
}

function bindDocumentsUI(){
  qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments);
  qs('#searchDocs')?.addEventListener('input', ()=> {
    const q = (qs('#searchDocs')?.value||'').toLowerCase();
    renderDocuments(documents.filter(d=> (d.name||'').toLowerCase().includes(q)));
  });
}

// ---------------- SETTINGS ----------------
function bindSettingPage(){
  const currentUsername = getUsername();
  if(qs('#currentUser')) qs('#currentUser').textContent = currentUsername;

  qs('#changePasswordBtn')?.addEventListener('click', async ()=>{
    const newPass = qs('#newPassword')?.value;
    const confPass = qs('#confirmPassword')?.value;
    const code = qs('#securityCode')?.value;
    const msgEl = qs('#passwordMessage');
    showMsg(msgEl,'');
    if(!newPass||!confPass||!code) return showMsg(msgEl,'⚠️ Fill all fields','red');
    if(newPass !== confPass) return showMsg(msgEl,'⚠️ Passwords do not match','red');
    if(!confirm('Change password?')) return;
    try{
      const res = await apiFetch(`${API_BASE}/account/password`, { method:'PUT', body: JSON.stringify({ username: currentUsername, newPassword: newPass, securityCode: code }) });
      const data = await res.json();
      if(res.ok){ showMsg(msgEl,'✅ Password updated. Logging out...', 'green'); setTimeout(logout,1200); }
      else showMsg(msgEl, `❌ ${data.message||'Failed'}`, 'red');
    }catch(e){ showMsg(msgEl,'❌ Server error','red'); }
  });

  qs('#deleteAccountBtn')?.addEventListener('click', async ()=>{
    if(!confirm('Delete account?')) return;
    const code = prompt('Enter Admin Security Code');
    if(!code) return;
    try{
      const res = await apiFetch(`${API_BASE}/account`, { method:'DELETE', body: JSON.stringify({ username: currentUsername, securityCode: code }) });
      const data = await res.json();
      if(res.ok){ alert('Account deleted'); logout(); } else alert(`Failed: ${data.message||''}`);
    }catch(e){ alert('Server error'); }
  });
}

// ---------------- SALES UI (Simple Search Box) ----------------

function bindSalesUI(){
  // download buttons if present
  qs('#downloadSalesXLSXBtnInline')?.addEventListener('click', downloadSalesReportXLSX);
  qs('#downloadSalesPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/sales/report/pdf`, '_blank'));
  // Add Sale UI control
  qs('#addSaleBtn')?.addEventListener('click', openSaleModal);
  // If the page has inline download top buttons
  qs('#downloadSalesXLSXBtn')?.addEventListener('click', downloadSalesReportXLSX);
}

function openSaleModal(){
  if(!qs('#saleModal')){
    const modal = document.createElement('div');
    modal.id = 'saleModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-inner" style="background:white;padding:20px;border-radius:8px;max-width:520px;margin:60px auto;">
        <h3>Add New Sale</h3>
        <label>Search Product (SKU / Name)</label>
        <input id="sale_search" placeholder="Type to search inventory..."/>
        <div id="sale_suggestions" style="max-height:150px;overflow:auto;margin:8px 0;border:1px solid #eee;padding:6px;"></div>
        <label>SKU</label><input id="sale_sku" readonly />
        <label>Product Name</label><input id="sale_product" readonly />
        <label>Quantity</label><input id="sale_quantity" type="number" value="1" min="1" />
        <label>Price (RM) - editable</label><input id="sale_price" type="number" step="0.01" />
        <label>Total: RM <span id="sale_total_display">0.00</span></label>
        <div style="margin-top:12px;display:flex;gap:8px;">
          <button id="saveSaleBtn" class="primary-btn">Save Sale</button>
          <button id="saleModalClose" class="secondary-btn">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    // bind events
    qs('#sale_search').addEventListener('input', saleSearchHandler);
    qs('#sale_quantity').addEventListener('input', updateSaleTotal);
    qs('#sale_price').addEventListener('input', updateSaleTotal);
    qs('#saveSaleBtn').addEventListener('click', addSaleFromModal);
    qs('#saleModalClose').addEventListener('click', ()=> qs('#saleModal').style.display='none');
  } else {
    // reset fields
    qs('#sale_search').value=''; qs('#sale_suggestions').innerHTML=''; qs('#sale_sku').value=''; qs('#sale_product').value=''; qs('#sale_quantity').value=1; qs('#sale_price').value=''; qs('#sale_total_display').textContent='0.00';
  }
  qs('#saleModal').style.display = 'block';
}

function saleSearchHandler(e){
  const q = (e.target.value||'').toLowerCase().trim();
  const suggestions = qs('#sale_suggestions');
  suggestions.innerHTML = '';
  if(!q) return;
  const matches = inventory.filter(i=> (i.sku||'').toLowerCase().includes(q) || (i.name||'').toLowerCase().includes(q));
  matches.slice(0,20).forEach(m=>{
    const item = document.createElement('div');
    item.style = 'padding:6px;border-bottom:1px solid #f1f1f1;cursor:pointer;';
    item.textContent = `${m.sku} — ${m.name} (RM ${Number(m.unitPrice||0).toFixed(2)}) — qty:${m.quantity||0}`;
    item.addEventListener('click', ()=>{
      qs('#sale_sku').value = m.sku || '';
      qs('#sale_product').value = m.name || '';
      qs('#sale_price').value = (Number(m.unitPrice||0)).toFixed(2);
      qs('#sale_quantity').value = 1;
      updateSaleTotal();
      suggestions.innerHTML = '';
      qs('#sale_search').value = `${m.sku} ${m.name}`;
    });
    suggestions.appendChild(item);
  });
}

function updateSaleTotal(){
  const qty = Number(qs('#sale_quantity')?.value || 0);
  const price = Number(qs('#sale_price')?.value || 0);
  qs('#sale_total_display').textContent = (qty * price).toFixed(2);
}

async function addSaleFromModal(){
  const sku = qs('#sale_sku')?.value?.trim();
  const product = qs('#sale_product')?.value?.trim();
  const quantity = Number(qs('#sale_quantity')?.value || 0);
  const price = Number(qs('#sale_price')?.value || 0);
  const total = Number((quantity * price).toFixed(2));
  if(!sku || !product || quantity <= 0) return alert('Select product and quantity');
  if(!confirm(`Save sale: ${product} x${quantity} (RM ${total.toFixed(2)})?`)) return;

  try{
    const res = await apiFetch(`${API_BASE}/sales`, { method:'POST', body: JSON.stringify({ invoice: `INV-${Date.now()}`, product, sku, quantity, total }) });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }

    // reduce inventory quantity for the sold SKU
    const item = inventory.find(i => String(i.sku) === String(sku) || String(i.id) === String(sku));
    if(item){
      const newQty = Math.max(0, (Number(item.quantity||0) - Number(quantity)));
      await apiFetch(`${API_BASE}/inventory/${item.id}`, { method:'PUT', body: JSON.stringify({ ...item, quantity: newQty }) });
    }

    await fetchSales();
    await fetchInventory();
    qs('#saleModal').style.display = 'none';
    alert('Sale recorded');
  }catch(e){ console.error(e); alert('Server error'); }
}

async function downloadSalesReportXLSX(){
  try{
    const res = await apiFetch(`${API_BASE}/sales/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Sales_Report.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchSales();
  }catch(e){ console.error(e); alert('Error'); }
}

// ---------------- ORDERS UI (Simple Search + multi-item; auto-fill price editable) ----------------

function bindOrdersUI(){
  qs('#downloadOrdersXLSXBtnInline')?.addEventListener('click', downloadOrdersReportXLSX);
  qs('#downloadOrdersPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/orders/report/pdf`, '_blank'));
  qs('#addOrderBtn')?.addEventListener('click', openOrderModal);
  // top buttons too
  qs('#downloadOrdersXLSXBtn')?.addEventListener('click', downloadOrdersReportXLSX);
}

function openOrderModal(){
  if(!qs('#orderModal')){
    const modal = document.createElement('div');
    modal.id = 'orderModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-inner" style="background:white;padding:20px;border-radius:8px;max-width:820px;margin:40px auto;">
        <h3>Create New Order</h3>
        <label>Customer Name</label><input id="order_customer" />
        <div style="margin-top:8px;">
          <label>Search Product to add (SKU / Name)</label>
          <input id="order_item_search" placeholder="Type to search..."/>
          <div id="order_item_suggestions" style="max-height:150px;overflow:auto;border:1px solid #eee;padding:6px;margin-top:6px;"></div>
        </div>
        <div id="order_items_list" style="margin-top:12px;"></div>
        <div style="margin-top:12px;display:flex;align-items:center;gap:10px;">
          <label style="margin:0;">Total: RM <span id="order_total_display">0.00</span></label>
          <div style="flex:1"></div>
          <button id="saveOrderBtn" class="primary-btn">Save Order</button>
          <button id="orderModalClose" class="secondary-btn">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    qs('#order_item_search').addEventListener('input', orderItemSearchHandler);
    qs('#orderModalClose').addEventListener('click', ()=> qs('#orderModal').style.display='none');
    qs('#saveOrderBtn').addEventListener('click', saveOrderFromModal);
  } else {
    // reset
    qs('#order_customer').value=''; qs('#order_item_search').value=''; qs('#order_item_suggestions').innerHTML=''; qs('#order_items_list').innerHTML=''; qs('#order_total_display').textContent='0.00';
  }
  qs('#orderModal').style.display = 'block';
}

function orderItemSearchHandler(e){
  const q = (e.target.value||'').toLowerCase().trim();
  const suggestions = qs('#order_item_suggestions');
  suggestions.innerHTML = '';
  if(!q) return;
  const matches = inventory.filter(i=> (i.sku||'').toLowerCase().includes(q) || (i.name||'').toLowerCase().includes(q));
  matches.slice(0,30).forEach(m=>{
    const div = document.createElement('div');
    div.style = 'padding:6px;border-bottom:1px solid #f1f1f1;cursor:pointer;';
    div.textContent = `${m.sku} — ${m.name} (RM ${(Number(m.unitPrice)||0).toFixed(2)}) — qty:${m.quantity||0}`;
    div.addEventListener('click', ()=>{
      appendOrderItem(m);
      suggestions.innerHTML = '';
      qs('#order_item_search').value = '';
    });
    suggestions.appendChild(div);
  });
}

function appendOrderItem(prod){
  const list = qs('#order_items_list');
  const row = document.createElement('div');
  row.className = 'order-item';
  row.style = 'display:flex;gap:8px;align-items:center;margin-top:8px;';
  row.innerHTML = `
    <input class="oi_sku" value="${escapeHtml(prod.sku||'')}" readonly style="width:120px"/>
    <input class="oi_name" value="${escapeHtml(prod.name||'')}" readonly style="flex:2"/>
    <input class="oi_qty" type="number" value="1" min="1" style="width:80px"/>
    <input class="oi_price" type="number" step="0.01" value="${(Number(prod.unitPrice)||0).toFixed(2)}" style="width:110px"/>
    <span class="oi_subtotal money" style="width:110px">RM ${(Number(prod.unitPrice)||0).toFixed(2)}</span>
    <button class="danger-btn removeOrderItemBtn">Remove</button>
  `;
  list.appendChild(row);

  const qtyEl = row.querySelector('.oi_qty');
  const priceEl = row.querySelector('.oi_price');
  const subtotalEl = row.querySelector('.oi_subtotal');
  function recalc(){
    const q = Number(qtyEl.value||0); const p = Number(priceEl.value||0);
    subtotalEl.textContent = 'RM ' + (q*p).toFixed(2);
    updateOrderTotalFromModal();
  }
  qtyEl.addEventListener('input', recalc);
  priceEl.addEventListener('input', recalc);
  row.querySelector('.removeOrderItemBtn').addEventListener('click', ()=>{
    row.remove(); updateOrderTotalFromModal();
  });
  updateOrderTotalFromModal();
}

function updateOrderTotalFromModal(){
  const rows = qsa('#order_items_list .order-item');
  let total = 0;
  rows.forEach(r=>{
    const q = Number(r.querySelector('.oi_qty')?.value || 0);
    const p = Number(r.querySelector('.oi_price')?.value || 0);
    total += q * p;
  });
  qs('#order_total_display').textContent = total.toFixed(2);
}

async function saveOrderFromModal(){
  const customer = qs('#order_customer')?.value?.trim();
  if(!customer) return alert('Enter customer name');
  const rows = qsa('#order_items_list .order-item');
  if(rows.length === 0) return alert('Add at least one item');

  const items = rows.map(r=>({
    sku: r.querySelector('.oi_sku')?.value || '',
    name: r.querySelector('.oi_name')?.value || '',
    qty: Number(r.querySelector('.oi_qty')?.value || 0),
    price: Number(r.querySelector('.oi_price')?.value || 0)
  }));
  const total = items.reduce((s,i)=> s + (Number(i.qty||0) * Number(i.price||0)), 0);

  if(!confirm(`Save order for ${customer}, total RM ${total.toFixed(2)}?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/orders`, { method:'POST', body: JSON.stringify({ customerName: customer, items, total }) });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }

    // decrement inventory quantities by SKU if present
    for(const it of items){
      const inv = inventory.find(i => String(i.sku) === String(it.sku));
      if(inv){
        const newQty = Math.max(0, Number(inv.quantity || 0) - Number(it.qty || 0));
        await apiFetch(`${API_BASE}/inventory/${inv.id}`, { method:'PUT', body: JSON.stringify({ ...inv, quantity: newQty }) });
      }
    }

    await fetchOrders();
    await fetchInventory();
    qs('#orderModal').style.display = 'none';
    alert('Order saved');
  }catch(e){ console.error(e); alert('Server error'); }
}

async function downloadOrdersReportXLSX(){
  try{
    const res = await apiFetch(`${API_BASE}/orders/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition'); const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Orders_Report.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchOrders();
  }catch(e){ console.error(e); alert('Error'); }
}

// ---------------- ZIP all reports (dashboard) ----------------
async function downloadAllReportsZip(){
  try{
    const res = await apiFetch(`${API_BASE}/reports/zip`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download = `All_Reports_${new Date().toISOString().slice(0,10)}.zip`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }catch(e){ console.error(e); alert('Error'); }
}

// ---------------- Expose globals used by inline handlers ----------------
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadSalesReportXLSX = downloadSalesReportXLSX;
window.downloadOrdersReportXLSX = downloadOrdersReportXLSX;
window.downloadAllReportsZip = downloadAllReportsZip;
window.addOrderItemRow = () => {}; // kept for compatibility

// ---------------- Small compatibility stubs (if other pages bind to them) ----------------
function bindProductPage(){ /* implemented above where needed */ }

