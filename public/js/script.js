// public/js/script.js
// Consolidated client script (inventory + sales + orders + documents + auth)
// Make sure to replace API_BASE if your backend runs on a different host/port.

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : `${window.location.origin}/api`;

const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [], sales = [], orders = [], documents = [], activityLog = [];
const currentPage = window.location.pathname.split('/').pop();

// Simple fetch wrapper attaches X-Username
async function apiFetch(url, options = {}) {
  const user = getUsername();
  options.headers = { 'Content-Type': 'application/json', 'X-Username': user, ...(options.headers||{}) };
  return fetch(url, options);
}

/* -------- Auth redirect (don't redirect on login page) -------- */
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  try { window.location.href = 'login.html'; } catch(e) {}
}

function logout(){
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('adminName');
  window.location.href = 'login.html';
}
function toggleTheme(){ document.body.classList.toggle('dark-mode'); if(window.CONFIG && CONFIG.LS_THEME) localStorage.setItem(CONFIG.LS_THEME, document.body.classList.contains('dark-mode') ? 'dark' : 'light'); }

/* ================= RENDERERS ================= */

function renderInventory(items){
  const listEl = qs('#inventoryList'); if(!listEl) return;
  listEl.innerHTML = '';
  let totalValue = 0, totalRevenue = 0, totalStock = 0;
  items.forEach(it=>{
    const id = it.id || it._id;
    const qty = Number(it.quantity||0);
    const uc = Number(it.unitCost||0);
    const up = Number(it.unitPrice||0);
    const invVal = qty * uc;
    const rev = qty * up;
    totalValue += invVal; totalRevenue += rev; totalStock += qty;
    const tr = document.createElement('tr');
    if(qty===0) tr.classList.add('out-of-stock-row'); else if(qty < 10) tr.classList.add('low-stock-row');
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
    listEl.appendChild(tr);
  });
  if(qs('#totalValue')) qs('#totalValue').textContent = totalValue.toFixed(2);
  if(qs('#totalRevenue')) qs('#totalRevenue').textContent = totalRevenue.toFixed(2);
  if(qs('#totalStock')) qs('#totalStock').textContent = totalStock;
}

function renderSales(rows){
  const t = qs('#salesList'); if(!t) return; t.innerHTML = '';
  rows.forEach(r=>{
    const id = r.id || r._id;
    const dateStr = r.date ? new Date(r.date).toLocaleString() : '';
    const productLabel = r.productSku ? `${escapeHtml(r.product)} (${escapeHtml(r.productSku)})` : escapeHtml(r.product);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(r.invoice||'')}</td><td>${productLabel}</td><td>${Number(r.quantity||0)}</td><td class="money">RM ${(Number(r.total)||0).toFixed(2)}</td><td>${escapeHtml(dateStr)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditSaleModal('${id}')">✏️ Edit</button>
        <button class="danger-btn small-btn" onclick="confirmDeleteSale('${id}')">🗑️ Delete</button>
      </td>`;
    t.appendChild(tr);
  });
}

function renderOrders(rows){
  const t = qs('#ordersList'); if(!t) return; t.innerHTML = '';
  rows.forEach(o=>{
    const id = o.id || o._id;
    const dateStr = o.date ? new Date(o.date).toLocaleString() : '';
    const itemsSummary = (Array.isArray(o.items) ? o.items.map(i=>`${escapeHtml(i.name||i.sku||'')} x${i.qty}`).join(', ') : '');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(o.orderNumber||o._id?.toString?.()||'')}</td>
      <td>${escapeHtml(o.customerName||'')}</td>
      <td>${itemsSummary}</td>
      <td class="money">RM ${(Number(o.total)||0).toFixed(2)}</td>
      <td>${escapeHtml(o.status||'Pending')}</td>
      <td>${escapeHtml(dateStr)}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="openEditOrderModal('${id}')">✏️ Edit</button>
        <button class="secondary-btn small-btn" onclick="cancelOrder('${id}')">✖️ Cancel</button>
        <button class="danger-btn small-btn" onclick="confirmDeleteOrder('${id}')">🗑️ Delete</button>
      </td>`;
    t.appendChild(tr);
  });
}

/* ================= FETCHERS ================= */

async function fetchInventory(){ try{ const res = await apiFetch(`${API_BASE}/inventory`); if(!res.ok) throw new Error(); inventory = await res.json(); renderInventory(inventory); populateProductDatalist(); }catch(e){ console.error('fetchInventory', e); } }
async function fetchSales(){ try{ const res = await apiFetch(`${API_BASE}/sales`); if(!res.ok) { sales = []; renderSales(sales); return; } sales = await res.json(); renderSales(sales); }catch(e){ console.error('fetchSales', e); } }
async function fetchOrders(){ try{ const res = await apiFetch(`${API_BASE}/orders`); if(!res.ok) { orders = []; renderOrders(orders); return; } orders = await res.json(); renderOrders(orders); }catch(e){ console.error('fetchOrders', e); } }
async function fetchDocuments(){ try{ const res = await apiFetch(`${API_BASE}/documents`); if(!res.ok) throw new Error(); documents = await res.json(); }catch(e){ console.error('fetchDocuments', e); } }
async function fetchLogs(){ try{ const res = await apiFetch(`${API_BASE}/logs`); if(!res.ok) throw new Error(); activityLog = await res.json(); renderDashboardData(); }catch(e){ console.error('fetchLogs', e); } }

/* ================= INIT ================= */

window.addEventListener('load', async () => {
  if(qs('#adminName')) qs('#adminName').textContent = getUsername();
  // apply saved theme
  if(window.CONFIG && CONFIG.LS_THEME) {
    const theme = localStorage.getItem(CONFIG.LS_THEME);
    if(theme === 'dark') document.body.classList.add('dark-mode');
  }

  try {
    if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
    if(currentPage.includes('sales')) { await fetchInventory(); await fetchSales(); bindSalesUI(); }
    if(currentPage.includes('orders')) { await fetchInventory(); await fetchOrders(); bindOrdersUI(); }
    if(currentPage.includes('documents')) { await fetchDocuments(); bindDocumentsUI(); }
    if(currentPage.includes('log') || currentPage === '' || currentPage === 'index.html') { await fetchLogs(); await fetchInventory(); }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
    if(currentPage.includes('login.html')) bindLoginPage();
  } catch(e) { console.error('init error', e); }
});

/* ================= AUTH (login/register) ================= */

function bindLoginPage(){
  qs('#loginBtn')?.addEventListener('click', async ()=>{
    const user = qs('#username')?.value?.trim();
    const pass = qs('#password')?.value?.trim();
    const msg = qs('#loginMessage');
    showMsg(msg,'');
    if(!user||!pass) return showMsg(msg,'⚠️ Enter username & password','red');
    try{
      const res = await apiFetch(`${API_BASE}/login`, { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
      const data = await res.json();
      if(res.ok){ sessionStorage.setItem('isLoggedIn','true'); sessionStorage.setItem('adminName', user); showMsg(msg,'✅ Login successful','green'); setTimeout(()=> window.location.href='index.html',500); }
      else showMsg(msg, `❌ ${data.message||'Login failed'}`,'red');
    }catch(e){ showMsg(msg,'❌ Server error','red'); console.error(e); }
  });

  qs('#registerBtn')?.addEventListener('click', async ()=>{
    const user = qs('#newUsername')?.value?.trim();
    const pass = qs('#newPassword')?.value?.trim();
    const code = qs('#securityCode')?.value?.trim();
    if(!user||!pass||!code) return showMsg(qs('#registerMessage'),'⚠️ Fill all fields','red');
    try{
      const res = await apiFetch(`${API_BASE}/register`, { method:'POST', body: JSON.stringify({ username: user, password: pass, securityCode: code }) });
      const data = await res.json();
      if(res.ok){ showMsg(qs('#registerMessage'),'✅ Registered. Login now','green'); setTimeout(()=> qs('#toggleToLogin')?.click(), 900); }
      else showMsg(qs('#registerMessage'), `❌ ${data.message||'Register failed'}`,'red');
    }catch(e){ showMsg(qs('#registerMessage'),'❌ Server error','red'); console.error(e); }
  });

  qs('#toggleToRegister')?.addEventListener('click', ()=> { qs('#loginForm').style.display='none'; qs('#registerForm').style.display='block'; qs('#formTitle').textContent='🧾 Register Account'; });
  qs('#toggleToLogin')?.addEventListener('click', ()=> { qs('#loginForm').style.display='block'; qs('#registerForm').style.display='none'; qs('#formTitle').textContent='🔐 User Login'; });
}

/* ================= INVENTORY CRUD ================= */

async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value?.trim();
  const name = qs('#p_name')?.value?.trim();
  const category = qs('#p_category')?.value?.trim();
  const quantity = Number(qs('#p_quantity')?.value || 0);
  const unitCost = Number(qs('#p_unitCost')?.value || 0);
  const unitPrice = Number(qs('#p_unitPrice')?.value || 0);
  if(!sku||!name) return alert('Enter SKU and Name');
  if(!confirm(`Add product ${name}?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory`, { method:'POST', body: JSON.stringify({ sku,name,category,quantity,unitCost,unitPrice }) });
    if(res.ok){ ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id=> qs(id) && (qs(id).value='')); await fetchInventory(); alert('Product added'); }
    else { const err = await res.json(); alert('Add failed: ' + (err.message||'')); }
  }catch(e){ console.error(e); alert('Server error'); }
}

async function confirmAndDeleteItem(id){
  const it = inventory.find(x=>String(x.id)===String(id));
  if(!it) return alert('Item not found');
  if(!confirm(`Delete ${it.name}?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method:'DELETE' });
    if(res.status === 204){ await fetchInventory(); alert('Deleted'); } else { alert('Delete failed'); }
  }catch(e){ console.error(e); alert('Server error'); }
}

async function confirmAndGenerateReport(){
  if(!confirm('Generate inventory Excel?')) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Inventory_Report.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchDocuments();
  }catch(e){ console.error(e); alert('Report error'); }
}

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport);
  // PDF action open
  qs('#reportPdfBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/inventory/report/pdf`, '_blank'));
  qs('#searchInput')?.addEventListener('input', ()=>{
    const q = (qs('#searchInput')?.value||'').toLowerCase().trim();
    renderInventory(inventory.filter(it=> (it.sku||'').toLowerCase().includes(q) || (it.name||'').toLowerCase().includes(q) || (it.category||'').toLowerCase().includes(q)));
  });
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { if(qs('#searchInput')) { qs('#searchInput').value=''; renderInventory(inventory); } });
}

/* ================= PRODUCT PAGE BINDING ================= */

function openEditPageForItem(id){ window.location.href = `product.html?id=${encodeURIComponent(id)}`; }

async function bindProductPage(){
  const params = new URLSearchParams(window.location.search); const id = params.get('id');
  if(id){
    try{
      const res = await apiFetch(`${API_BASE}/inventory`);
      const items = await res.json();
      const it = items.find(x=> String(x.id) === String(id));
      if(!it) return alert('Item not found');
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
      if(res.ok){ alert('Updated'); window.location.href='inventory.html'; } else { const err = await res.json(); alert('Failed: '+(err.message||'')); }
    }catch(e){ console.error(e); alert('Server error'); }
  });
  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href='inventory.html');
}

/* ================= DOCUMENTS ================= */

async function uploadDocuments(){
  const files = qs('#docUpload')?.files || [];
  if(files.length === 0) return showMsg(qs('#uploadMessage'),'Select files','red');
  if(!confirm(`Upload metadata for ${files.length} files?`)) return;
  for(const f of files){
    try{
      const res = await apiFetch(`${API_BASE}/documents`, { method:'POST', body: JSON.stringify({ name: f.name, sizeBytes: f.size, type: f.type }) });
      if(!res.ok) throw new Error('Failed to upload metadata');
    }catch(e){ console.error(e); showMsg(qs('#uploadMessage'),`Failed ${f.name}`); return; }
  }
  qs('#docUpload').value = ''; setTimeout(()=> fetchDocuments(), 800); showMsg(qs('#uploadMessage'),'Uploaded','green');
}

function bindDocumentsUI(){
  qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments);
  qs('#searchDocs')?.addEventListener('input', ()=>{
    const q = (qs('#searchDocs')?.value||'').toLowerCase().trim();
    const filtered = documents.filter(d => (d.name||'').toLowerCase().includes(q));
    renderDocuments(filtered);
  });
}

/* ================= SALES (modal add/edit) ================= */

function bindSalesUI(){
  qs('#addSaleBtn')?.addEventListener('click', openSaleModal);
  qs('#downloadSalesXLSXBtnInline')?.addEventListener('click', downloadSalesReportXLSX);
  // sales pdf button handled inline in HTML
}

function openSaleModal(existing){
  // existing: sale object to edit (optional)
  if(!qs('#saleModal')){
    const modal = document.createElement('div');
    modal.id = 'saleModal';
    modal.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:flex-start;overflow:auto;padding:40px 16px;';
    modal.innerHTML = `
      <div style="background:white;padding:20px;border-radius:8px;max-width:520px;width:100%;">
        <h3 id="saleModalTitle">Add Sale</h3>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <label>Invoice (optional)</label>
          <input id="sale_invoice" placeholder="Invoice # (optional)" />
          <label>Product (type name or SKU)</label>
          <input id="sale_product" list="productList" placeholder="Product name or SKU" />
          <datalist id="productList"></datalist>
          <label>SKU (auto-filled)</label>
          <input id="sale_product_sku" readonly />
          <label>Quantity</label>
          <input id="sale_quantity" type="number" min="1" value="1" />
          <label>Total (RM)</label>
          <input id="sale_total" type="number" step="0.01" />
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
            <button id="saveSaleBtn" class="primary-btn">Save</button>
            <button id="closeSaleBtn" class="secondary-btn">Close</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // bind events
    qs('#saveSaleBtn')?.addEventListener('click', saveSaleFromModal);
    qs('#closeSaleBtn')?.addEventListener('click', ()=> qs('#saleModal').style.display='none');
    // product change -> autofill sku & price
    qs('#sale_product')?.addEventListener('input', onSaleProductInput);
  }
  qs('#saleModalTitle').textContent = existing ? 'Edit Sale' : 'Add Sale';
  // clear or set fields
  qs('#sale_invoice').value = existing?.invoice || '';
  qs('#sale_product').value = existing?.product || '';
  qs('#sale_product_sku').value = existing?.productSku || '';
  qs('#sale_quantity').value = existing?.quantity || 1;
  qs('#sale_total').value = existing?.total || 0;
  qs('#saleModal').style.display = 'flex';
  // store edit id
  qs('#saleModal').dataset.editId = existing?.id || existing?._id || '';
}

function onSaleProductInput(e){
  const val = e.target.value.trim().toLowerCase();
  // find by sku or name
  const found = inventory.find(it => (it.sku||'').toLowerCase() === val || (it.name||'').toLowerCase() === val || `${(it.name||'')} ${(it.sku||'')}`.toLowerCase().includes(val));
  if(found){
    qs('#sale_product_sku').value = found.sku || '';
    // default total = price * qty
    const qty = Number(qs('#sale_quantity')?.value || 1);
    qs('#sale_total').value = (Number(found.unitPrice||found.unitCost||0) * qty).toFixed(2);
  } else {
    // clear sku if not exact match
    qs('#sale_product_sku').value = '';
  }
}

async function saveSaleFromModal(){
  const invoice = qs('#sale_invoice')?.value?.trim();
  const product = qs('#sale_product')?.value?.trim();
  const sku = qs('#sale_product_sku')?.value?.trim();
  const quantity = Number(qs('#sale_quantity')?.value || 0);
  const total = Number(qs('#sale_total')?.value || 0);
  if(!product || quantity <= 0) return alert('Enter product and quantity');
  const editId = qs('#saleModal')?.dataset?.editId;
  try{
    const payload = { invoice, product, productSku: sku, quantity, total };
    if(editId){
      const res = await apiFetch(`${API_BASE}/sales/${encodeURIComponent(editId)}`, { method:'PUT', body: JSON.stringify(payload) });
      if(!res.ok) { const err = await res.json(); return alert('Save failed: ' + (err.message||'')); }
      alert('Sale updated');
    } else {
      const res = await apiFetch(`${API_BASE}/sales`, { method:'POST', body: JSON.stringify(payload) });
      if(!res.ok) { const err = await res.json(); return alert('Create failed: ' + (err.message||'')); }
      alert('Sale saved');
    }
    qs('#saleModal').style.display = 'none';
    await fetchSales();
    await fetchInventory(); // if sales affect inventory
  }catch(e){ console.error(e); alert('Server error'); }
}

function openEditSaleModal(id){
  const s = sales.find(x=> String(x.id) === String(id) || String(x._id) === String(id));
  openSaleModal(s);
}

async function confirmDeleteSale(id){
  if(!confirm('Delete sale?')) return;
  try{
    const res = await apiFetch(`${API_BASE}/sales/${encodeURIComponent(id)}`, { method:'DELETE' });
    if(res.status === 204 || res.ok){ alert('Deleted'); await fetchSales(); } else { alert('Delete failed'); }
  }catch(e){ console.error(e); alert('Server error'); }
}

/* download sales xlsx */
async function downloadSalesReportXLSX(){
  try{
    const res = await apiFetch(`${API_BASE}/sales/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: '+(err.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition'); const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Sales_Report.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchSales();
  }catch(e){ console.error(e); alert('Error'); }
}

/* ================= ORDERS (advanced modal, items chosen from inventory) ================= */

function bindOrdersUI(){
  qs('#addOrderBtn')?.addEventListener('click', openOrderModal);
  qs('#downloadOrdersXLSXBtnInline')?.addEventListener('click', downloadOrdersReportXLSX);
}

function openOrderModal(existing){
  if(!qs('#orderModal')){
    const modal = document.createElement('div');
    modal.id = 'orderModal';
    modal.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:flex-start;overflow:auto;padding:40px 10px;';
    modal.innerHTML = `
      <div style="background:white;padding:18px;border-radius:8px;max-width:880px;width:100%;">
        <h3 id="orderModalTitle">Create New Order</h3>
        <div style="display:flex;gap:12px;margin-bottom:8px;">
          <div style="flex:1;">
            <label>Customer Name</label>
            <input id="order_customer" placeholder="Customer full name" />
          </div>
          <div style="width:160px;">
            <label>Order # (optional)</label>
            <input id="order_number" placeholder="Order #" />
          </div>
        </div>
        <div id="order_items_container" style="border:1px solid #eee;padding:10px;border-radius:6px;min-height:60px;"></div>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
          <button id="addOrderItemBtn" class="secondary-btn">+ Add Item</button>
          <div style="flex:1"></div>
          <label style="margin:0;">Total: RM <span id="order_total_display">0.00</span></label>
          <button id="saveOrderBtn" class="primary-btn">Save Order</button>
          <button id="orderModalClose" class="secondary-btn">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    qs('#addOrderItemBtn')?.addEventListener('click', addOrderItemRow);
    qs('#saveOrderBtn')?.addEventListener('click', saveOrderFromModal);
    qs('#orderModalClose')?.addEventListener('click', ()=> qs('#orderModal').style.display = 'none');
  }

  // clear & populate
  qs('#order_customer').value = existing?.customerName || '';
  qs('#order_number').value = existing?.orderNumber || '';
  const container = qs('#order_items_container'); container.innerHTML = '';
  if(existing && Array.isArray(existing.items) && existing.items.length){
    existing.items.forEach(it => addOrderItemRow(it));
  } else {
    addOrderItemRow();
  }
  qs('#order_total_display').textContent = (existing?.total || 0).toFixed(2);
  qs('#orderModal').style.display = 'flex';
  qs('#orderModal').dataset.editId = existing?.id || existing?._id || '';
}

function addOrderItemRow(prefill){
  const container = qs('#order_items_container');
  const row = document.createElement('div');
  row.style = 'display:flex;gap:8px;align-items:center;margin-top:8px;';
  row.className = 'order-item-row';
  row.innerHTML = `
    <input class="order_product" list="productList" placeholder="Product name or SKU" style="flex:2" />
    <input class="order_sku" placeholder="SKU" style="width:120px" />
    <input class="order_qty" type="number" min="1" value="${prefill?.qty||1}" style="width:80px" />
    <input class="order_price" type="number" step="0.01" value="${(prefill?.price||0).toFixed ? (prefill?.price||0).toFixed(2) : (prefill?.price||0)}" style="width:120px" />
    <button class="danger-btn removeOrderItem">Remove</button>`;
  container.appendChild(row);

  // populate datalist for product suggestions (same datalist used by sales)
  populateProductDatalist();

  // events: when product chosen -> autofill sku & price
  row.querySelector('.order_product').addEventListener('input', (e)=>{
    const v = e.target.value.trim().toLowerCase();
    const found = inventory.find(it => (it.sku||'').toLowerCase() === v || (it.name||'').toLowerCase() === v || `${it.name} ${it.sku}`.toLowerCase().includes(v));
    if(found){
      row.querySelector('.order_sku').value = found.sku || '';
      // auto-fill price (unitPrice preferred)
      row.querySelector('.order_price').value = Number(found.unitPrice || found.unitCost || 0).toFixed(2);
      updateOrderTotalFromModal();
    }
  });

  row.querySelector('.order_qty').addEventListener('input', updateOrderTotalFromModal);
  row.querySelector('.order_price').addEventListener('input', updateOrderTotalFromModal);
  row.querySelector('.removeOrderItem')?.addEventListener('click', ()=>{
    row.remove(); updateOrderTotalFromModal();
  });

  updateOrderTotalFromModal();
}

function updateOrderTotalFromModal(){
  const rows = qsa('#order_items_container .order-item-row');
  let total = 0;
  rows.forEach(r=>{
    const q = Number(r.querySelector('.order_qty')?.value || 0);
    const p = Number(r.querySelector('.order_price')?.value || 0);
    total += q * p;
  });
  qs('#order_total_display').textContent = total.toFixed(2);
}

async function saveOrderFromModal(){
  const customer = qs('#order_customer')?.value?.trim();
  const orderNumber = qs('#order_number')?.value?.trim();
  if(!customer) return alert('Enter customer name');
  const rows = qsa('#order_items_container .order-item-row');
  if(rows.length === 0) return alert('Add at least one item');
  const items = rows.map(r => ({ sku: r.querySelector('.order_sku')?.value.trim(), name: r.querySelector('.order_product')?.value.trim(), qty: Number(r.querySelector('.order_qty')?.value||0), price: Number(r.querySelector('.order_price')?.value||0) }));
  const total = items.reduce((s,i)=> s + (Number(i.qty||0) * Number(i.price||0)), 0);
  const payload = { customerName: customer, orderNumber, items, total, status: 'Pending' };
  const editId = qs('#orderModal')?.dataset?.editId;
  try{
    if(editId){
      const res = await apiFetch(`${API_BASE}/orders/${encodeURIComponent(editId)}`, { method:'PUT', body: JSON.stringify(payload) });
      if(!res.ok) { const err = await res.json(); return alert('Save failed: ' + (err.message||'')); }
      alert('Order updated');
    } else {
      const res = await apiFetch(`${API_BASE}/orders`, { method:'POST', body: JSON.stringify(payload) });
      if(!res.ok) { const err = await res.json(); return alert('Create failed: ' + (err.message||'')); }
      alert('Order saved');
    }
    qs('#orderModal').style.display = 'none';
    await fetchOrders();
  }catch(e){ console.error(e); alert('Server error'); }
}

function openEditOrderModal(id){
  const o = orders.find(x=> String(x.id) === String(id) || String(x._id) === String(id));
  openOrderModal(o);
}

async function cancelOrder(id){
  if(!confirm('Mark order as Cancelled?')) return;
  try{
    const res = await apiFetch(`${API_BASE}/orders/${encodeURIComponent(id)}`, { method:'PUT', body: JSON.stringify({ status: 'Cancelled' }) });
    if(!res.ok) { const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    alert('Order cancelled');
    await fetchOrders();
  }catch(e){ console.error(e); alert('Server error'); }
}

async function confirmDeleteOrder(id){
  if(!confirm('Delete order?')) return;
  try{
    const res = await apiFetch(`${API_BASE}/orders/${encodeURIComponent(id)}`, { method:'DELETE' });
    if(res.status === 204 || res.ok){ alert('Deleted'); await fetchOrders(); } else alert('Delete failed');
  }catch(e){ console.error(e); alert('Server error'); }
}

async function downloadOrdersReportXLSX(){
  try{
    const res = await apiFetch(`${API_BASE}/orders/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: '+(err.message||'')); }
    const blob = await res.blob(); const cd = res.headers.get('Content-Disposition');
    const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Orders_Report.xlsx`;
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    await fetchOrders();
  }catch(e){ console.error(e); alert('Error'); }
}

/* ================= ZIP ALL REPORTS (dashboard) ================= */

async function downloadAllReportsZip(){
  try{
    const res = await apiFetch(`${API_BASE}/reports/zip`, { method:'GET' });
    if(!res.ok) { const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download = `All_Reports_${new Date().toISOString().slice(0,10)}.zip`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }catch(e){ console.error(e); alert('Error'); }
}

/* ================= HELPERS & small bindings ================= */

function populateProductDatalist(){
  // single datalist reused by sales & orders; create if missing
  if(!qs('#productList')) {
    const dl = document.createElement('datalist'); dl.id = 'productList'; document.body.appendChild(dl);
  }
  const dl = qs('#productList');
  if(!dl) return;
  dl.innerHTML = '';
  inventory.forEach(it => {
    const opt = document.createElement('option');
    opt.value = `${it.name} ${it.sku}`.trim();
    dl.appendChild(opt);
  });
}

function renderDocuments(docs){
  const t = qs('#docList'); if(!t) return; t.innerHTML = '';
  docs.forEach(d=>{
    const id = d.id || d._id;
    const sizeMB = ((d.sizeBytes || d.size || 0) / (1024*1024)).toFixed(2);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(d.name||'')}</td><td>${sizeMB} MB</td><td>${escapeHtml(new Date(d.date).toLocaleString())}</td>
      <td class="actions">
        <button class="primary-btn small-btn" onclick="downloadDocument('${encodeURIComponent(d.name||'')}')">⬇️ Download</button>
        <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${id}')">🗑️ Delete</button>
      </td>`;
    t.appendChild(tr);
  });
}

function downloadDocument(fnEnc){ const fn = decodeURIComponent(fnEnc); if(!confirm(`Download ${fn}?`)) return; window.open(`${API_BASE}/documents/download/${encodeURIComponent(fn)}`, '_blank'); }
async function deleteDocumentConfirm(id){ const d = documents.find(x=> String(x.id)===String(id)); if(!d) return; if(!confirm(`Delete ${d.name}?`)) return; try{ const res = await apiFetch(`${API_BASE}/documents/${id}`, { method:'DELETE' }); if(res.status===204){ await fetchDocuments(); alert('Deleted'); } else alert('Failed'); }catch(e){ console.error(e); alert('Server error'); } }

/* ================= SETTINGS & DASHBOARD ================= */

function bindSettingPage(){
  const currentUsername = getUsername();
  if(qs('#currentUser')) qs('#currentUser').textContent = currentUsername;
  qs('#changePasswordBtn')?.addEventListener('click', async ()=>{
    const newPass = qs('#newPassword')?.value, conf = qs('#confirmPassword')?.value, code = qs('#securityCode')?.value;
    const msgEl = qs('#passwordMessage'); showMsg(msgEl,'');
    if(!newPass||!conf||!code) return showMsg(msgEl,'⚠️ Fill all','red');
    if(newPass !== conf) return showMsg(msgEl,'⚠️ Password mismatch','red');
    if(!confirm('Change password?')) return;
    try{
      const res = await apiFetch(`${API_BASE}/account/password`, { method:'PUT', body: JSON.stringify({ username: currentUsername, newPassword: newPass, securityCode: code }) });
      const data = await res.json();
      if(res.ok){ showMsg(msgEl,'✅ Password updated. Logging out...','green'); setTimeout(()=> logout(), 1200); } else showMsg(msgEl, `❌ ${data.message||'Failed'}`,'red');
    }catch(e){ showMsg(msgEl,'❌ Server error','red'); }
  });

  qs('#deleteAccountBtn')?.addEventListener('click', async ()=>{
    if(!confirm('Delete your account?')) return;
    const code = prompt('Enter Admin Security Code:');
    if(!code) return alert('Cancelled');
    try{
      const res = await apiFetch(`${API_BASE}/account`, { method:'DELETE', body: JSON.stringify({ username: currentUsername, securityCode: code }) });
      const data = await res.json();
      if(res.ok){ alert('Account deleted'); logout(); } else alert(`Failed: ${data.message||''}`);
    }catch(e){ alert('Server error'); }
  });
}

/* Dashboard helper (renders recent activities and totals) */
function renderDashboardData(){
  // recentActivities table
  const tbody = qs('#recentActivities');
  if(tbody && Array.isArray(activityLog)){
    tbody.innerHTML = '';
    activityLog.slice(0,5).forEach(l=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(l.user||'System')}</td><td>${escapeHtml(l.action||'')}</td><td>${escapeHtml(new Date(l.time).toLocaleString())}</td>`;
      tbody.appendChild(tr);
    });
  }
  if(qs('#dash_totalItems')){
    let tv=0,trv=0,ts=0;
    inventory.forEach(it=>{ const q=Number(it.quantity||0); tv += q*Number(it.unitCost||0); trv += q*Number(it.unitPrice||0); ts += q; });
    qs('#dash_totalItems').textContent = inventory.length;
    qs('#dash_totalValue').textContent = tv.toFixed(2);
    qs('#dash_totalRevenue').textContent = trv.toFixed(2);
    qs('#dash_totalStock').textContent = ts;
  }
}

/* Expose some functions globally for inline handlers */
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.openEditSaleModal = openEditSaleModal;
window.openEditOrderModal = openEditOrderModal;
window.downloadSalesReportXLSX = downloadSalesReportXLSX;
window.downloadOrdersReportXLSX = downloadOrdersReportXLSX;
window.downloadAllReportsZip = downloadAllReportsZip;
window.populateProductDatalist = populateProductDatalist;
