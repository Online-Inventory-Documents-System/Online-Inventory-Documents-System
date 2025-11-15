// public/js/script.js
// Unified client script for Inventory, Orders & Sales with search dropdown + modal logic
// Update API_BASE if using different host
const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = s => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [], sales = [], orders = [], activityLog = [], documents = [];
const currentPage = window.location.pathname.split('/').pop();

// Basic fetch wrapper (adds X-Username and JSON content type)
async function apiFetch(url, options = {}) {
  const user = getUsername();
  options.headers = { 'Content-Type': 'application/json', 'X-Username': user, ...(options.headers || {}) };
  return fetch(url, options);
}

/* ========================= AUTH / REDIRECT ========================= */
// don't redirect when on login page
if (!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  try { window.location.href = 'login.html'; } catch(e) {}
}

function logout() {
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('adminName');
  window.location.href = 'login.html';
}

function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  if (window.CONFIG && CONFIG.LS_THEME) {
    localStorage.setItem(CONFIG.LS_THEME, document.body.classList.contains('dark-mode') ? 'dark' : 'light');
  }
}

/* ========================= RENDERERS ========================= */

function renderInventory(items = []) {
  const tbody = qs('#inventoryList');
  if(!tbody) return;
  tbody.innerHTML = '';
  let totalValue = 0, totalRevenue = 0, totalStock = 0;
  items.forEach(it => {
    const id = it.id || it._id;
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const invVal = qty * uc;
    const rev = qty * up;
    totalValue += invVal; totalRevenue += rev; totalStock += qty;

    const tr = document.createElement('tr');
    if (qty === 0) tr.classList.add('out-of-stock-row');
    else if (qty < 10) tr.classList.add('low-stock-row');

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
    tbody.appendChild(tr);
  });

  if(qs('#totalValue')) qs('#totalValue').textContent = totalValue.toFixed(2);
  if(qs('#totalRevenue')) qs('#totalRevenue').textContent = totalRevenue.toFixed(2);
  if(qs('#totalStock')) qs('#totalStock').textContent = totalStock;
}

function renderSales(rows = []) {
  const t = qs('#salesList'); if(!t) return;
  t.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.invoice || '')}</td>
      <td>${escapeHtml(r.product || '')}</td>
      <td>${Number(r.quantity||0)}</td>
      <td class="money">RM ${(Number(r.total)||0).toFixed(2)}</td>
      <td>${new Date(r.date||Date.now()).toLocaleString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditSale('${r.id||r._id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="deleteSaleConfirm('${r.id||r._id}')">🗑️ Delete</button>
      </td>
    `;
    t.appendChild(tr);
  });
}

function renderOrders(rows = []) {
  const t = qs('#ordersList'); if(!t) return;
  t.innerHTML = '';
  rows.forEach(o => {
    const id = o.id || o._id;
    const orderNo = o.orderNumber || o.orderNumber || (o._id ? String(o._id).slice(-6) : '—');
    const itemsSummary = Array.isArray(o.items) ? o.items.map(i => `${escapeHtml(i.name||i.sku||'')} x${i.qty}`).join(', ') : '';
    const statusClass = o.status === 'Approved' ? 'status-completed' : (o.status === 'Cancelled' ? 'status-cancelled' : 'status-pending');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(orderNo)}</td>
      <td>${escapeHtml(o.customerName || '')}</td>
      <td>${itemsSummary}</td>
      <td class="money">RM ${(Number(o.total)||0).toFixed(2)}</td>
      <td><span class="order-status ${statusClass}">${escapeHtml(o.status||'Pending')}</span></td>
      <td>${new Date(o.date||Date.now()).toLocaleString()}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditOrder('${id}')">✏️ Edit</button>
        <button class="secondary-btn small-btn" onclick="changeOrderStatusPrompt('${id}')">⚙️ Status</button>
        <button class="danger-btn small-btn" onclick="deleteOrderConfirm('${id}')">🗑️ Delete</button>
      </td>
    `;
    t.appendChild(tr);
  });
}

/* Dashboard small table of recent activities & totals */
function renderDashboardData(){
  // recent activity rows
  if(qs('#recentActivities')) {
    const tbody = qs('#recentActivities');
    tbody.innerHTML = '';
    (activityLog || []).slice().slice(0,5).forEach(l => {
      const tr = document.createElement('tr');
      const timeStr = l.time ? new Date(l.time).toLocaleString() : new Date().toLocaleString();
      tr.innerHTML = `<td>${escapeHtml(l.user||'System')}</td><td>${escapeHtml(l.action||'')}</td><td>${escapeHtml(timeStr)}</td>`;
      tbody.appendChild(tr);
    });
  }

  // dashboard totals
  if(qs('#dash_totalItems')) {
    let totalValue = 0, totalRevenue = 0, totalStock = 0;
    (inventory || []).forEach(it => {
      const qty = Number(it.quantity||0);
      totalValue += qty * Number(it.unitCost||0);
      totalRevenue += qty * Number(it.unitPrice||0);
      totalStock += qty;
    });
    qs('#dash_totalItems').textContent = (inventory||[]).length;
    qs('#dash_totalValue').textContent = totalValue.toFixed(2);
    qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
    qs('#dash_totalStock').textContent = totalStock;
  }
}

/* ========================= FETCHERS ========================= */

async function fetchInventory() {
  try {
    const res = await apiFetch(`${API_BASE}/inventory`);
    if (!res.ok) throw new Error('Failed to fetch inventory');
    const data = await res.json();
    // normalize ids
    inventory = (Array.isArray(data) ? data : []).map(i => ({ ...i, id: i.id || i._id }));
    renderInventory(inventory);
  } catch (err) { console.error('fetchInventory:', err); }
}

async function fetchSales() {
  try {
    const res = await apiFetch(`${API_BASE}/sales`);
    if (!res.ok) throw new Error('Failed to fetch sales');
    const data = await res.json();
    sales = (Array.isArray(data) ? data : []).map(s => ({ ...s, id: s.id || s._id }));
    renderSales(sales);
  } catch (err) { console.error('fetchSales:', err); }
}

async function fetchOrders() {
  try {
    const res = await apiFetch(`${API_BASE}/orders`);
    if (!res.ok) throw new Error('Failed to fetch orders');
    const data = await res.json();
    orders = (Array.isArray(data) ? data : []).map(o => ({ ...o, id: o.id || o._id }));
    renderOrders(orders);
  } catch (err) { console.error('fetchOrders:', err); }
}

async function fetchDocuments() {
  try {
    const res = await apiFetch(`${API_BASE}/documents`);
    if (!res.ok) throw new Error('Failed to fetch documents');
    documents = await res.json();
  } catch (err) { console.error('fetchDocuments:', err); }
}

async function fetchLogs() {
  try {
    const res = await apiFetch(`${API_BASE}/logs`);
    if (!res.ok) throw new Error('Failed to fetch logs');
    activityLog = await res.json();
    renderDashboardData();
  } catch (err) { console.error('fetchLogs:', err); }
}

/* ========================= INITIALIZATION ========================= */

window.addEventListener('load', async () => {
  // fill admin name in header
  if (qs('#adminName')) qs('#adminName').textContent = getUsername();
  // apply theme
  if (window.CONFIG && CONFIG.LS_THEME) {
    const t = localStorage.getItem(CONFIG.LS_THEME);
    if (t === 'dark') document.body.classList.add('dark-mode');
  }

  try {
    if (currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
    if (currentPage.includes('sales')) { await fetchSales(); bindSalesUI(); }
    if (currentPage.includes('orders')) { await fetchOrders(); bindOrdersUI(); }
    if (currentPage.includes('documents')) { await fetchDocuments(); bindDocumentsUI(); }
    if (currentPage.includes('log') || currentPage === '' || currentPage === 'index.html') { await fetchLogs(); await fetchInventory(); }
    if (currentPage.includes('product')) bindProductPage();
    if (currentPage.includes('setting')) bindSettingPage();
  } catch(e) {
    console.error('init error', e);
  }
});

/* ========================= AUTH (login/register) ========================= */

async function login() {
  const user = qs('#username')?.value?.trim();
  const pass = qs('#password')?.value?.trim();
  const msg = qs('#loginMessage');
  showMsg(msg, '');
  if (!user || !pass) { showMsg(msg, '⚠️ Enter username and password', 'red'); return; }
  try {
    const res = await apiFetch(`${API_BASE}/login`, { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
    const data = await res.json();
    if (res.ok) {
      sessionStorage.setItem('isLoggedIn', 'true');
      sessionStorage.setItem('adminName', user);
      showMsg(msg, '✅ Login successful', 'green');
      setTimeout(() => window.location.href = 'index.html', 600);
    } else {
      showMsg(msg, `❌ ${data.message || 'Login failed'}`, 'red');
    }
  } catch (err) {
    showMsg(msg, '❌ Server error', 'red');
    console.error('login err', err);
  }
}

async function register() {
  const user = qs('#newUsername')?.value?.trim();
  const pass = qs('#newPassword')?.value?.trim();
  const code = qs('#securityCode')?.value?.trim();
  const msg = qs('#registerMessage');
  showMsg(msg, '');
  if (!user || !pass || !code) { showMsg(msg, '⚠️ Fill all fields', 'red'); return; }
  try {
    const res = await apiFetch(`${API_BASE}/register`, { method: 'POST', body: JSON.stringify({ username: user, password: pass, securityCode: code }) });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, '✅ Registered. Login now', 'green');
      setTimeout(toggleForm, 900);
    } else showMsg(msg, `❌ ${data.message || 'Registration failed'}`, 'red');
  } catch (err) {
    showMsg(msg, '❌ Server error', 'red');
    console.error(err);
  }
}

function toggleForm(){
  const loginForm = qs('#loginForm'), registerForm = qs('#registerForm'), formTitle = qs('#formTitle');
  if (!loginForm || !registerForm || !formTitle) return;
  if (getComputedStyle(loginForm).display === 'none') {
    loginForm.style.display = 'block'; registerForm.style.display = 'none'; formTitle.textContent = '🔐 Admin Login';
  } else {
    loginForm.style.display = 'none'; registerForm.style.display = 'block'; formTitle.textContent = '🧾 Register Account';
  }
}

/* ========================= INVENTORY CRUD ========================= */

async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value?.trim();
  const name = qs('#p_name')?.value?.trim();
  const category = qs('#p_category')?.value?.trim();
  const quantity = Number(qs('#p_quantity')?.value || 0);
  const unitCost = Number(qs('#p_unitCost')?.value || 0);
  const unitPrice = Number(qs('#p_unitPrice')?.value || 0);
  if (!sku || !name) return alert('Enter SKU and Name');
  if (!confirm(`Add product "${name}"?`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory`, { method: 'POST', body: JSON.stringify({ sku,name,category,quantity,unitCost,unitPrice }) });
    if (res.ok) { ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id => { if(qs(id)) qs(id).value=''; }); await fetchInventory(); alert('Added'); }
    else { const err = await res.json(); alert('Failed: ' + (err.message||'')); }
  } catch (e) { console.error(e); alert('Server error'); }
}

async function confirmAndDeleteItem(id) {
  const it = inventory.find(x => String(x.id) === String(id));
  if (!it) return; if (!confirm(`Delete ${it.name}?`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method: 'DELETE' });
    if (res.status === 204) { await fetchInventory(); alert('Deleted'); }
    else { const err = await res.json(); alert('Failed: ' + (err.message||'')); }
  } catch(e) { console.error(e); alert('Server error'); }
}

async function confirmAndGenerateReport(){
  if(!confirm('Generate inventory Excel?')) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Inventory_Report_${Date.now()}.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    // refresh docs list
    await fetchDocuments();
    alert('Report generated & downloaded');
  }catch(e){ console.error(e); alert('Error generating report'); }
}

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport);
  qs('#searchInput')?.addEventListener('input', ()=> {
    const q = (qs('#searchInput')?.value||'').toLowerCase();
    renderInventory(inventory.filter(it=> (it.sku||'').toLowerCase().includes(q) || (it.name||'').toLowerCase().includes(q) || (it.category||'').toLowerCase().includes(q)));
  });
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { if(qs('#searchInput')) { qs('#searchInput').value=''; renderInventory(inventory); } });
}

/* Product edit page */
function openEditPageForItem(id) { window.location.href = `product.html?id=${encodeURIComponent(id)}`; }
async function bindProductPage(){
  const params = new URLSearchParams(window.location.search); const id = params.get('id');
  if (id) {
    try {
      const res = await apiFetch(`${API_BASE}/inventory`); const items = await res.json();
      const it = items.find(x=> String(x.id) === String(id));
      if(!it) return alert('Item not found');
      if(qs('#prod_id')) qs('#prod_id').value = it.id || it._id;
      if(qs('#prod_sku')) qs('#prod_sku').value = it.sku || '';
      if(qs('#prod_name')) qs('#prod_name').value = it.name || '';
      if(qs('#prod_category')) qs('#prod_category').value = it.category || '';
      if(qs('#prod_quantity')) qs('#prod_quantity').value = it.quantity || 0;
      if(qs('#prod_unitCost')) qs('#prod_unitCost').value = it.unitCost || 0;
      if(qs('#prod_unitPrice')) qs('#prod_unitPrice').value = it.unitPrice || 0;
    } catch (e) { console.error(e); alert('Load failed'); }
  }
  qs('#saveProductBtn')?.addEventListener('click', async ()=>{
    if(!confirm('Save changes?')) return;
    const idVal = qs('#prod_id')?.value;
    const body = {
      sku: qs('#prod_sku')?.value, name: qs('#prod_name')?.value, category: qs('#prod_category')?.value,
      quantity: Number(qs('#prod_quantity')?.value||0), unitCost: Number(qs('#prod_unitCost')?.value||0), unitPrice: Number(qs('#prod_unitPrice')?.value||0)
    };
    try {
      const res = await apiFetch(`${API_BASE}/inventory/${idVal}`, { method:'PUT', body: JSON.stringify(body) });
      if(res.ok) { alert('Updated'); window.location.href = 'inventory.html'; }
      else { const err = await res.json(); alert('Failed: ' + (err.message||'')); }
    } catch(e) { console.error(e); alert('Server error'); }
  });
  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href = 'inventory.html');
}

/* ========================= DOCUMENTS ========================= */

async function uploadDocuments(){
  const files = qs('#docUpload')?.files || [];
  const msgEl = qs('#uploadMessage') || null;
  if(files.length === 0) { if(msgEl) showMsg(msgEl, '⚠️ Select files'); return; }
  if(!confirm(`Upload ${files.length} documents metadata?`)) { if(msgEl) showMsg(msgEl, 'Cancelled','orange'); return; }
  for(const f of files) {
    try {
      const res = await apiFetch(`${API_BASE}/documents`, { method:'POST', body: JSON.stringify({ name: f.name, type: f.type, sizeBytes: f.size }) });
      if(!res.ok) throw new Error('Upload failed');
    } catch(e) { console.error(e); if(msgEl) showMsg(msgEl, `Failed ${f.name}`,'red'); return; }
  }
  qs('#docUpload').value = '';
  setTimeout(()=> fetchDocuments(), 700);
  if(msgEl) showMsg(msgEl, 'Uploaded','green');
}
function downloadDocument(fileNameEncoded) {
  const fileName = decodeURIComponent(fileNameEncoded);
  if(!confirm(`Download ${fileName}?`)) return;
  window.open(`${API_BASE}/documents/download/${encodeURIComponent(fileName)}`, '_blank');
}
async function deleteDocumentConfirm(id) {
  const d = documents.find(x=>String(x.id) === String(id));
  if(!d) return; if(!confirm(`Delete ${d.name}?`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/documents/${id}`, { method:'DELETE' });
    if(res.status === 204) { await fetchDocuments(); alert('Deleted'); }
    else { const err = await res.json(); alert('Failed: ' + (err.message||'')); }
  } catch(e) { console.error(e); alert('Server error'); }
}
function bindDocumentsUI(){
  qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments);
  qs('#searchDocs')?.addEventListener('input', ()=> {
    const q = (qs('#searchDocs')?.value||'').toLowerCase();
    renderDocuments((documents||[]).filter(d => (d.name||'').toLowerCase().includes(q)));
  });
}

/* ========================= SALES UI ========================= */

function bindSalesUI(){
  // downloads
  qs('#downloadSalesXLSXBtnInline')?.addEventListener('click', downloadSalesReportXLSX);
  qs('#downloadSalesPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/sales/report/pdf`, '_blank'));

  // add sale button (modal)
  qs('#addSaleBtn')?.addEventListener('click', openSaleModal);
  // modal close/save are bound in openSaleModal creation
}

function openSaleModal(existingSale){
  // build modal only once
  if(!qs('#saleModal')){
    const modal = document.createElement('div'); modal.id = 'saleModal'; modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-inner" style="background:white;padding:20px;border-radius:8px;max-width:520px;margin:60px auto;">
        <h3 id="saleModalTitle">Add Sale</h3>
        <label>Invoice</label><input id="sale_invoice" />
        <label>Product (search)</label><input id="sale_product_search" placeholder="type SKU or name" />
        <div id="sale_product_dropdown" class="search-dropdown"></div>
        <label>Quantity</label><input id="sale_quantity" type="number" value="1" min="1" />
        <label>Total (RM)</label><input id="sale_total" type="number" step="0.01" />
        <div style="margin-top:12px;display:flex;gap:8px;">
          <button id="saveSaleBtn" class="primary-btn">Save</button>
          <button id="saleModalClose" class="secondary-btn">Close</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // events
    qs('#sale_product_search').addEventListener('input', (e)=> buildSimpleDropdown(e.target.value, '#sale_product_dropdown', inventory, onSalePick));
    qs('#saleModalClose').addEventListener('click', ()=> qs('#saleModal').style.display='none');
    qs('#saveSaleBtn').addEventListener('click', addSale);
  }

  // prefill when editing
  if (existingSale) {
    qs('#saleModalTitle').textContent = 'Edit Sale';
    qs('#sale_invoice').value = existingSale.invoice || '';
    qs('#sale_product_search').value = existingSale.product || '';
    qs('#sale_quantity').value = existingSale.quantity || 1;
    qs('#sale_total').value = existingSale.total || 0;
    qs('#saveSaleBtn').dataset.editId = existingSale.id || existingSale._id;
  } else {
    qs('#saleModalTitle').textContent = 'Add Sale';
    qs('#sale_invoice').value = '';
    qs('#sale_product_search').value = '';
    qs('#sale_quantity').value = 1;
    qs('#sale_total').value = '';
    delete qs('#saveSaleBtn').dataset.editId;
  }

  qs('#saleModal').style.display='block';
}

function onSalePick(item) {
  // item: inventory item object
  if(!item) return;
  qs('#sale_product_search').value = `${item.sku} — ${item.name}`;
  // auto fill total as unitPrice * qty
  const qty = Number(qs('#sale_quantity')?.value || 1);
  qs('#sale_total').value = (Number(item.unitPrice||0) * qty).toFixed(2);
  // hide dropdown
  qs('#sale_product_dropdown').innerHTML = '';
}

async function addSale(){
  const editId = qs('#saveSaleBtn')?.dataset?.editId;
  const invoice = qs('#sale_invoice')?.value?.trim();
  const product = qs('#sale_product_search')?.value?.trim();
  const qty = Number(qs('#sale_quantity')?.value || 0);
  const total = Number(qs('#sale_total')?.value || 0);
  if (!product || qty <= 0) return alert('Fill product and qty');
  try {
    if(editId) {
      const res = await apiFetch(`${API_BASE}/sales/${encodeURIComponent(editId)}`, { method:'PUT', body: JSON.stringify({ invoice, product, quantity: qty, total }) });
      if(res.ok) { await fetchSales(); qs('#saleModal').style.display='none'; alert('Sale updated'); }
      else { const err = await res.json(); alert('Failed: '+(err.message||'')); }
    } else {
      const res = await apiFetch(`${API_BASE}/sales`, { method:'POST', body: JSON.stringify({ invoice, product, quantity: qty, total }) });
      if(res.ok) { await fetchSales(); qs('#saleModal').style.display='none'; alert('Sale recorded'); }
      else { const err = await res.json(); alert('Failed: '+(err.message||'')); }
    }
  } catch(e) { console.error(e); alert('Server error'); }
}

function openEditSale(id) {
  const s = sales.find(x => String(x.id || x._id) === String(id));
  if (!s) return alert('Sale not found');
  openSaleModal(s);
}

async function deleteSaleConfirm(id) {
  if(!confirm('Delete this sale?')) return;
  try {
    const res = await apiFetch(`${API_BASE}/sales/${id}`, { method:'DELETE' });
    if (res.status === 204 || res.ok) { await fetchSales(); alert('Deleted'); }
    else { const err = await res.json(); alert('Failed: ' + (err.message||'')); }
  } catch(e) { console.error(e); alert('Server error'); }
}

async function downloadSalesReportXLSX(){
  try {
    const res = await apiFetch(`${API_BASE}/sales/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition'); const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Sales_Report.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchSales();
  } catch(e) { console.error(e); alert('Error'); }
}

/* ========================= ORDERS UI (Advanced) ========================= */

function bindOrdersUI(){
  qs('#addOrderBtn')?.addEventListener('click', ()=> openOrderModal());
  qs('#downloadOrdersXLSXBtnInline')?.addEventListener('click', downloadOrdersReportXLSX);
  qs('#downloadOrdersPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/orders/report/pdf`, '_blank'));
  // openEditOrder, changeOrderStatusPrompt, deleteOrderConfirm are used inline from renderOrders
}

// Creates or shows the order modal
function openOrderModal(existingOrder) {
  // create once
  if(!qs('#orderModal')) {
    console.log('orderModal not present; create');
    // the HTML for order modal is in the page for most templates (we create fallback)
    const modal = document.createElement('div'); modal.id = 'orderModal'; modal.className='modal';
    modal.innerHTML = `
      <div class="modal-inner" style="background:white;padding:20px;border-radius:8px;max-width:720px;margin:60px auto;">
        <h3 id="orderModalTitle">Add New Order</h3>
        <label>Customer Name</label><input id="order_customer" />
        <label>Order No (optional)</label><input id="order_number" />
        <label>Search item (SKU / Name)</label><input id="order_item_search" placeholder="type to search inventory" />
        <div id="order_item_dropdown" class="search-dropdown"></div>

        <div class="table-container" style="margin-top:12px;">
          <table id="orderItemTable" style="min-width:600px;">
            <thead><tr><th>Item</th><th>Unit Price</th><th>Qty</th><th>Subtotal</th><th>Action</th></tr></thead>
            <tbody id="orderItemList"></tbody>
          </table>
        </div>

        <div style="margin-top:12px;display:flex;align-items:center;gap:12px;">
          <div><b>Total: RM <span id="order_total">0.00</span></b></div>
          <div style="flex:1"></div>
          <label>Order Status</label>
          <select id="order_status" style="padding:8px;">
            <option>Pending</option><option>Approved</option><option>Cancelled</option>
          </select>
        </div>

        <div style="margin-top:12px;display:flex;gap:8px;">
          <button id="saveOrderBtn" class="primary-btn">Save Order</button>
          <button id="orderModalClose" class="secondary-btn">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // events
    qs('#order_item_search').addEventListener('input', e => buildSimpleDropdown(e.target.value, '#order_item_dropdown', inventory, onOrderItemPick));
    qs('#orderModalClose').addEventListener('click', () => qs('#orderModal').style.display='none');
    qs('#saveOrderBtn').addEventListener('click', saveOrderFromModal);
  }

  // reset or populate
  qs('#orderItemList').innerHTML = '';
  qs('#order_customer').value = existingOrder ? existingOrder.customerName || '' : '';
  qs('#order_number').value = existingOrder ? (existingOrder.orderNumber || '') : '';
  qs('#order_status').value = existingOrder ? (existingOrder.status || 'Pending') : 'Pending';
  qs('#order_total').textContent = '0.00';
  if (existingOrder) {
    // add items
    (existingOrder.items || []).forEach(it => addOrderItemRow(it));
    qs('#saveOrderBtn').dataset.editId = existingOrder.id || existingOrder._id;
    qs('#orderModalTitle').textContent = 'Edit Order';
  } else {
    addOrderItemRow(); // default one row
    delete qs('#saveOrderBtn').dataset.editId;
    qs('#orderModalTitle').textContent = 'Add New Order';
  }

  qs('#orderModal').style.display = 'block';
}

function onOrderItemPick(item) {
  // adds an item row prefilled from inventory
  if(!item) return;
  addOrderItemRow({ sku: item.sku, name: item.name, price: Number(item.unitPrice||0), qty: 1 });
  qs('#order_item_dropdown').innerHTML = '';
  qs('#order_item_search').value = '';
  updateOrderTotalFromModal();
}

// Adds an order item row to modal; item object optional to prefill
function addOrderItemRow(item = null) {
  const tbody = qs('#orderItemList');
  if(!tbody) return;
  const tr = document.createElement('tr');

  const nameVal = item ? `${item.sku} — ${item.name}` : '';
  const priceVal = item ? Number(item.price||0).toFixed(2) : '0.00';
  const qtyVal = item ? Number(item.qty||1) : 1;
  tr.innerHTML = `
    <td><input class="order_row_name" placeholder="SKU — Name" value="${escapeHtml(nameVal)}" style="width:100%"></td>
    <td><input class="order_row_price" type="number" step="0.01" value="${escapeHtml(priceVal)}" style="width:120px"></td>
    <td><input class="order_row_qty" type="number" min="1" value="${escapeHtml(qtyVal)}" style="width:80px"></td>
    <td class="order_row_subtotal money">RM ${ (Number(priceVal) * Number(qtyVal)).toFixed(2) }</td>
    <td style="text-align:center;">
      <button class="danger-btn small-btn remove-order-row">Remove</button>
    </td>
  `;
  tbody.appendChild(tr);

  const priceInp = tr.querySelector('.order_row_price');
  const qtyInp = tr.querySelector('.order_row_qty');
  const subtotalTd = tr.querySelector('.order_row_subtotal');

  function recompute() {
    const p = Number(priceInp.value || 0);
    const q = Number(qtyInp.value || 0);
    subtotalTd.textContent = 'RM ' + (p * q).toFixed(2);
    updateOrderTotalFromModal();
  }

  priceInp.addEventListener('input', recompute);
  qtyInp.addEventListener('input', recompute);
  tr.querySelector('.remove-order-row').addEventListener('click', ()=> { tr.remove(); updateOrderTotalFromModal(); });

  updateOrderTotalFromModal();
}

// calculate order total in modal
function updateOrderTotalFromModal() {
  const rows = qsa('#orderItemList tr');
  let total = 0;
  rows.forEach(r => {
    const p = Number(r.querySelector('.order_row_price').value || 0);
    const q = Number(r.querySelector('.order_row_qty').value || 0);
    total += p * q;
  });
  if (qs('#order_total')) qs('#order_total').textContent = total.toFixed(2);
}

// save order from modal (create or update)
async function saveOrderFromModal(){
  const editId = qs('#saveOrderBtn').dataset.editId;
  const customer = qs('#order_customer')?.value?.trim();
  const orderNumber = qs('#order_number')?.value?.trim();
  const status = qs('#order_status')?.value || 'Pending';
  if(!customer) return alert('Enter customer name');
  const rows = qsa('#orderItemList tr');
  if(rows.length === 0) return alert('Add at least one item');
  const items = rows.map(r => {
    const name = r.querySelector('.order_row_name').value || '';
    // attempt to split sku & name if provided in "SKU — Name" format
    let sku = '', label = name;
    if (name.includes('—')) {
      const parts = name.split('—').map(p => p.trim());
      sku = parts[0]; label = parts.slice(1).join(' — ');
    }
    const qty = Number(r.querySelector('.order_row_qty').value || 0);
    const price = Number(r.querySelector('.order_row_price').value || 0);
    return { sku, name: label, qty, price };
  });
  const total = items.reduce((s,i) => s + (Number(i.qty||0) * Number(i.price||0)), 0);

  try {
    if (editId) {
      const res = await apiFetch(`${API_BASE}/orders/${encodeURIComponent(editId)}`, { method:'PUT', body: JSON.stringify({ customerName: customer, orderNumber, items, total, status }) });
      if (res.ok) { await fetchOrders(); qs('#orderModal').style.display='none'; alert('Order updated'); }
      else { const err = await res.json(); alert('Failed: ' + (err.message||'')); }
    } else {
      const res = await apiFetch(`${API_BASE}/orders`, { method:'POST', body: JSON.stringify({ customerName: customer, orderNumber, items, total, status }) });
      if (res.ok) { await fetchOrders(); qs('#orderModal').style.display='none'; alert('Order created'); }
      else { const err = await res.json(); alert('Failed: ' + (err.message||'')); }
    }
  } catch(e) { console.error(e); alert('Server error'); }
}

// open order edit - find order and call openOrderModal with existing data
function openEditOrder(id) {
  const o = orders.find(x => String(x.id || x._id) === String(id));
  if(!o) return alert('Order not found');
  // map to expected fields
  openOrderModal({ ...o, id: o.id || o._id });
}

// change order status by prompt or quick menu
async function changeOrderStatusPrompt(id) {
  const o = orders.find(x => String(x.id || x._id) === String(id));
  if(!o) return alert('Order not found');
  const newStatus = prompt('Set order status (Pending / Approved / Cancelled):', o.status || 'Pending');
  if(!newStatus) return;
  if (!['Pending','Approved','Cancelled'].includes(newStatus)) return alert('Invalid status');
  try {
    const res = await apiFetch(`${API_BASE}/orders/${encodeURIComponent(id)}`, { method:'PUT', body: JSON.stringify({ ...o, status: newStatus }) });
    if(res.ok) { await fetchOrders(); alert('Status updated'); }
    else { const err = await res.json(); alert('Failed: ' + (err.message||'')); }
  } catch(e) { console.error(e); alert('Server error'); }
}

async function deleteOrderConfirm(id) {
  if(!confirm('Delete this order?')) return;
  try {
    const res = await apiFetch(`${API_BASE}/orders/${encodeURIComponent(id)}`, { method:'DELETE' });
    if (res.status === 204 || res.ok) { await fetchOrders(); alert('Deleted'); }
    else { const err = await res.json(); alert('Failed: ' + (err.message||'')); }
  } catch(e) { console.error(e); alert('Server error'); }
}

async function downloadOrdersReportXLSX(){
  try {
    const res = await apiFetch(`${API_BASE}/orders/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Orders_Report.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchOrders();
  } catch(e) { console.error(e); alert('Error'); }
}

/* ========================= ZIP ALL REPORTS ========================= */

async function downloadAllReportsZip(){
  try {
    const res = await apiFetch(`${API_BASE}/reports/zip`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `All_Reports_${new Date().toISOString().slice(0,10)}.zip`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch(e) { console.error(e); alert('Error'); }
}

/* ========================= UTIL: Simple Search Dropdown (A - simple box + auto dropdown) =========================
   buildSimpleDropdown(query, dropdownSelector, listArray, onPick(item))
   - listArray: array of inventory objects [{sku,name,...}, ...]
   - displays up to 8 matches
*/
function buildSimpleDropdown(query, dropdownSelector, listArray, onPick) {
  const dropEl = qs(dropdownSelector);
  if(!dropEl) return;
  const q = (query || '').toLowerCase().trim();
  if(!q) { dropEl.innerHTML = ''; return; }

  const matches = (listArray || []).filter(i => (i.sku||'').toLowerCase().includes(q) || (i.name||'').toLowerCase().includes(q)).slice(0, 8);
  if(matches.length === 0) { dropEl.innerHTML = '<div style="padding:8px;color:#777">No matches</div>'; return; }

  dropEl.innerHTML = '';
  matches.forEach(m => {
    const div = document.createElement('div');
    div.style = 'padding:8px;cursor:pointer;border-bottom:1px solid #eee';
    div.textContent = `${m.sku} — ${m.name} (RM ${Number(m.unitPrice||0).toFixed(2)})`;
    div.addEventListener('click', ()=> { onPick && onPick(m); dropEl.innerHTML = ''; });
    dropEl.appendChild(div);
  });
}

/* ========================= SETTINGS & BINDINGS for login/register pages ========================= */
document.addEventListener('DOMContentLoaded', ()=> {
  // login/register page bindings
  if (currentPage.includes('login.html')) {
    qs('#loginBtn')?.addEventListener('click', login);
    qs('#registerBtn')?.addEventListener('click', register);
    qs('#toggleToRegister')?.addEventListener('click', toggleForm);
    qs('#toggleToLogin')?.addEventListener('click', toggleForm);
    if (qs('#contactPhone') && window.CONFIG && CONFIG.CONTACT_PHONE) qs('#contactPhone').textContent = CONFIG.CONTACT_PHONE;
  }
});

/* ========================= Expose globals used by inline onclick handlers ========================= */
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.openEditOrder = openEditOrder;
window.openEditSale = openEditSale;
window.downloadSalesReportXLSX = downloadSalesReportXLSX;
window.downloadOrdersReportXLSX = downloadOrdersReportXLSX;
window.downloadAllReportsZip = downloadAllReportsZip;

