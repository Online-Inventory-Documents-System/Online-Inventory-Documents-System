// public/js/script.js
// Full client-side script with Sales & Orders support and inventory chart drawing.

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [], sales = [], orders = [], activityLog = [], documents = [];
let inventoryChart = null;
const currentPage = window.location.pathname.split('/').pop();

// fetch wrapper
async function apiFetch(url, options={}) {
  const user = getUsername();
  options.headers = { 'Content-Type': 'application/json', 'X-Username': user, ...options.headers };
  return fetch(url, options);
}

/* --- Auth redirect --- */
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  try { window.location.href = 'login.html'; } catch(e) {}
}

function logout(){ sessionStorage.removeItem('isLoggedIn'); sessionStorage.removeItem('adminName'); window.location.href='login.html'; }
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
    const invVal = qty * uc, rev = qty * up;
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
  // update dashboard summary & chart
  renderDashboardData();
  drawInventoryChart();
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

/* ------------- Chart (Chart.js) ------------- */
function drawInventoryChart() {
  // expects inventory global populated. Aggregates by category (top 8)
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('inventoryChart');
  if (!canvas) return;
  // aggregate by category
  const map = {};
  inventory.forEach(it => {
    const cat = (it.category || 'Uncategorized').trim() || 'Uncategorized';
    map[cat] = (map[cat] || 0) + Number(it.quantity || 0);
  });
  const entries = Object.entries(map).sort((a,b)=> b[1]-a[1]);
  const labels = entries.slice(0,10).map(e=>e[0]);
  const data = entries.slice(0,10).map(e=>e[1]);

  const cfg = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Stock Quantity by Category',
        data,
        backgroundColor: 'rgba(54, 162, 235, 0.7)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true }
      },
      plugins: { legend: { display: false } }
    }
  };

  if (inventoryChart && inventoryChart.destroy) inventoryChart.destroy();
  inventoryChart = new Chart(canvas.getContext('2d'), cfg);
  window.inventoryChart = inventoryChart;
}

/* ===================== FETCHERS ===================== */

async function fetchInventory(){ try{ const res = await apiFetch(`${API_BASE}/inventory`); if(!res.ok) throw new Error('Failed'); inventory = await res.json(); renderInventory(inventory); }catch(e){console.error(e);} }
async function fetchSales(){ try{ const res = await apiFetch(`${API_BASE}/sales`); if(!res.ok) throw new Error('Failed'); sales = await res.json(); if(window.renderSales) renderSales(sales); }catch(e){console.error(e);} }
async function fetchOrders(){ try{ const res = await apiFetch(`${API_BASE}/orders`); if(!res.ok) throw new Error('Failed'); orders = await res.json(); if(window.renderOrders) renderOrders(orders); }catch(e){console.error(e);} }
async function fetchDocuments(){ try{ const res = await apiFetch(`${API_BASE}/documents`); if(!res.ok) throw new Error('Failed'); documents = await res.json(); renderDocuments(documents); }catch(e){console.error(e);} }
async function fetchLogs(){ try{ const res = await apiFetch(`${API_BASE}/logs`); if(!res.ok) throw new Error('Failed'); activityLog = await res.json(); renderLogs(); }catch(e){console.error(e);} }

/* ===================== INIT/BINDINGS ===================== */

window.addEventListener('load', async () => {
  const adminName = getUsername();
  if(qs('#adminName')) qs('#adminName').textContent = adminName;

  const theme = (window.CONFIG && CONFIG.LS_THEME) ? localStorage.getItem(CONFIG.LS_THEME) : null;
  if(theme === 'dark') document.body.classList.add('dark-mode');

  try {
    if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
    if(currentPage.includes('sales')) { await fetchSales(); bindSalesUI(); }
    if(currentPage.includes('orders')) { await fetchOrders(); bindOrdersUI(); }
    if(currentPage.includes('documents')) { await fetchDocuments(); bindDocumentsUI(); }
    if(currentPage.includes('log') || currentPage === '' || currentPage === 'index.html') { await fetchLogs(); await fetchInventory(); }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
  } catch(e) { console.error('Init error', e); }
});

/* ===================== Inventory CRUD ===================== */

async function confirmAndAddProduct(){ 
  const sku = qs('#p_sku')?.value?.trim(); const name = qs('#p_name')?.value?.trim();
  if(!sku||!name) return alert('Enter SKU & name');
  const category = qs('#p_category')?.value?.trim(); const quantity = Number(qs('#p_quantity')?.value||0);
  const unitCost = Number(qs('#p_unitCost')?.value||0); const unitPrice = Number(qs('#p_unitPrice')?.value||0);
  if(!confirm(`Add ${name}?`)) return;
  try{ const res = await apiFetch(`${API_BASE}/inventory`, { method:'POST', body: JSON.stringify({ sku,name,category,quantity,unitCost,unitPrice }) }); if(res.ok){ ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id=>qs(id)&& (qs(id).value='')); await fetchInventory(); alert('Added'); }else alert('Add failed'); }catch(e){console.error(e); alert('Server error');}
}

async function confirmAndDeleteItem(id){ const it = inventory.find(x=>String(x.id)===String(id)); if(!it) return; if(!confirm(`Delete ${it.name}?`)) return; try{ const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method:'DELETE' }); if(res.status===204){ await fetchInventory(); alert('Deleted'); } else alert('Delete failed'); }catch(e){console.error(e); alert('Server error');} }

async function confirmAndGenerateReport(){
  if(!confirm('Generate inventory Excel?')) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert(`Failed: ${err.message}`); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition'); const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Inventory_Report_${Date.now()}.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); await fetchDocuments(); alert('Report downloaded.');
  }catch(e){console.error(e); alert('Error');}
}

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport);
  qs('#searchInput')?.addEventListener('input', ()=>{ const q = (qs('#searchInput')?.value||'').toLowerCase(); renderInventory(inventory.filter(it=> (it.sku||'').toLowerCase().includes(q) || (it.name||'').toLowerCase().includes(q) || (it.category||'').toLowerCase().includes(q))); });
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { if(qs('#searchInput')) { qs('#searchInput').value=''; renderInventory(inventory); } });
}

/* ===================== Product page bindings ===================== */
function openEditPageForItem(id){ window.location.href = `product.html?id=${encodeURIComponent(id)}`; }
async function bindProductPage(){ /* uses existing inventory endpoint to fetch item then bind save */ 
  const params = new URLSearchParams(window.location.search); const id = params.get('id'); if(id){ try{ const res = await apiFetch(`${API_BASE}/inventory`); const items = await res.json(); const it = items.find(x=>String(x.id)===String(id)); if(!it) return alert('Not found'); qs('#prod_id')&&(qs('#prod_id').value=it.id||it._id); qs('#prod_sku')&&(qs('#prod_sku').value=it.sku||''); qs('#prod_name')&&(qs('#prod_name').value=it.name||''); qs('#prod_category')&&(qs('#prod_category').value=it.category||''); qs('#prod_quantity')&&(qs('#prod_quantity').value=it.quantity||0); qs('#prod_unitCost')&&(qs('#prod_unitCost').value=it.unitCost||0); qs('#prod_unitPrice')&&(qs('#prod_unitPrice').value=it.unitPrice||0); }catch(e){console.error(e); alert('Load failed'); } }
  qs('#saveProductBtn')?.addEventListener('click', async ()=>{ if(!confirm('Save changes?')) return; const idVal = qs('#prod_id')?.value; const body = { sku: qs('#prod_sku')?.value, name: qs('#prod_name')?.value, category: qs('#prod_category')?.value, quantity: Number(qs('#prod_quantity')?.value||0), unitCost: Number(qs('#prod_unitCost')?.value||0), unitPrice: Number(qs('#prod_unitPrice')?.value||0) }; try{ const res = await apiFetch(`${API_BASE}/inventory/${idVal}`, { method:'PUT', body: JSON.stringify(body) }); if(res.ok){ alert('Updated'); window.location.href='inventory.html'; } else { const err = await res.json(); alert('Failed: ' + (err.message||'')); } }catch(e){console.error(e); alert('Server error'); } });
  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href='inventory.html');
}

/* ===================== Documents ===================== */
async function uploadDocuments(){ const files = qs('#docUpload')?.files || []; if(files.length===0) return showMsg(qs('#uploadMessage'),'Select files','red'); if(!confirm(`Upload metadata for ${files.length} files?`)) return; for(const f of files){ try{ const res = await apiFetch(`${API_BASE}/documents`, { method:'POST', body: JSON.stringify({ name:f.name, sizeBytes: f.size, type: f.type }) }); if(!res.ok) throw new Error('Failed'); }catch(e){ console.error(e); showMsg(qs('#uploadMessage'),`Failed ${f.name}`); return; } } qs('#docUpload').value=''; setTimeout(()=>fetchDocuments(),800); showMsg(qs('#uploadMessage'),'Uploaded','green'); }
function downloadDocument(fnEnc){ const fn = decodeURIComponent(fnEnc); if(!confirm(`Download ${fn}?`)) return; window.open(`${API_BASE}/documents/download/${encodeURIComponent(fn)}`,'_blank'); }
async function deleteDocumentConfirm(id){ const d = documents.find(x=>String(x.id)===String(id)); if(!d) return; if(!confirm(`Delete ${d.name}?`)) return; try{ const res = await apiFetch(`${API_BASE}/documents/${id}`, { method:'DELETE' }); if(res.status===204){ await fetchDocuments(); alert('Deleted'); } else alert('Failed'); }catch(e){console.error(e); alert('Server error');} }
function bindDocumentsUI(){ qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments); qs('#searchDocs')?.addEventListener('input', ()=>{ const q=(qs('#searchDocs')?.value||'').toLowerCase(); renderDocuments(documents.filter(d=> (d.name||'').toLowerCase().includes(q))); }); }

/* ===================== Sales UI ===================== */

function bindSalesUI(){
  qs('#downloadSalesXLSXBtnInline')?.addEventListener('click', downloadSalesReportXLSX);
  qs('#downloadSalesPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/sales/report/pdf`, '_blank'));
  qs('#addSaleBtn')?.addEventListener('click', ()=> openSaleModal());
  // delegate actions for edit/delete in table (we'll add data-id attributes)
  qs('#salesList')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset?.id;
    if (!id) return;
    if (btn.classList.contains('edit-sale')) {
      openEditSaleModal(id);
    } else if (btn.classList.contains('delete-sale')) {
      if (!confirm('Delete sale?')) return;
      try {
        const res = await apiFetch(`${API_BASE}/sales/${id}`, { method: 'DELETE' });
        if (res.status === 204) { await fetchSales(); alert('Deleted'); } else { alert('Delete failed'); }
      } catch (err) { console.error(err); alert('Server error'); }
    }
  });
}

function renderSales(rows){
  const t = qs('#salesList'); if(!t) return;
  window.sales = rows;
  t.innerHTML = '';
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    const dateStr = r.date ? new Date(r.date).toLocaleString() : '';
    tr.innerHTML = `<td>${escapeHtml(r.invoice)}</td><td>${escapeHtml(r.product)}</td><td>${r.quantity}</td><td class="money">RM ${(Number(r.total)||0).toFixed(2)}</td><td>${dateStr}</td>
      <td class="actions">
        <button class="primary-btn small-btn edit-sale" data-id="${r.id}">✏️ Edit</button>
        <button class="danger-btn small-btn delete-sale" data-id="${r.id}">🗑️ Delete</button>
      </td>`;
    t.appendChild(tr);
  });
}

/* Sale modal (add/edit) */
function openSaleModal(initial = {}) {
  if (!qs('#saleModal')) {
    const modal = document.createElement('div');
    modal.id = 'saleModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-inner" style="background:white;padding:20px;border-radius:8px;max-width:520px;margin:60px auto;">
        <h3 id="saleModalTitle">Add New Sale</h3>
        <input id="sale_id" type="hidden" />
        <label>Invoice</label><input id="sale_invoice" />
        <label>Product (SKU or name)</label><input id="sale_product" list="productOptions" />
        <datalist id="productOptions"></datalist>
        <label>Quantity</label><input id="sale_quantity" type="number" value="1" min="1" />
        <label>Total (RM)</label><input id="sale_total" type="number" step="0.01" />
        <div style="margin-top:12px;display:flex;gap:8px;">
          <button id="saveSaleBtn" class="primary-btn">Save</button>
          <button id="saleModalClose" class="secondary-btn">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    qs('#saveSaleBtn')?.addEventListener('click', addOrUpdateSale);
    qs('#saleModalClose')?.addEventListener('click', ()=> qs('#saleModal').style.display='none');
  }
  // populate datalist productOptions with inventory items
  const dl = qs('#productOptions');
  if (dl) {
    dl.innerHTML = '';
    inventory.forEach(it=> {
      const opt = document.createElement('option');
      opt.value = `${it.sku} - ${it.name}`;
      dl.appendChild(opt);
    });
  }
  qs('#sale_id').value = initial.id || '';
  qs('#sale_invoice').value = initial.invoice || '';
  qs('#sale_product').value = initial.product || '';
  qs('#sale_quantity').value = initial.quantity || 1;
  qs('#sale_total').value = initial.total || '';
  qs('#saleModalTitle').textContent = initial.id ? 'Edit Sale' : 'Add New Sale';
  qs('#saleModal').style.display = 'block';
}

function openEditSaleModal(id){
  const s = (window.sales || []).find(x=> String(x.id) === String(id));
  if(!s) return alert('Sale not found');
  openSaleModal(s);
}

async function addOrUpdateSale(){
  const id = qs('#sale_id')?.value;
  const invoice = qs('#sale_invoice')?.value?.trim();
  const product = qs('#sale_product')?.value?.trim();
  const quantity = Number(qs('#sale_quantity')?.value || 0);
  const total = Number(qs('#sale_total')?.value || 0);
  if(!product || quantity <= 0) return alert('Product and quantity required');
  const body = { invoice, product, quantity, total };
  try{
    if(id) {
      const res = await apiFetch(`${API_BASE}/sales/${id}`, { method:'PUT', body: JSON.stringify(body) });
      if (res.ok) { await fetchSales(); qs('#saleModal').style.display='none'; alert('Updated'); }
      else { const err = await res.json(); alert('Failed: ' + (err.message || '')); }
    } else {
      const res = await apiFetch(`${API_BASE}/sales`, { method:'POST', body: JSON.stringify(body) });
      if (res.ok) { await fetchSales(); qs('#saleModal').style.display='none'; alert('Saved'); }
      else { const err = await res.json(); alert('Failed: ' + (err.message || '')); }
    }
  }catch(e){ console.error(e); alert('Server error'); }
}

/* Download Sales XLSX */
async function downloadSalesReportXLSX(){
  try{
    const res = await apiFetch(`${API_BASE}/sales/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert('Failed: ' + (err.message||'')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition'); const fn = cd && cd.match(/filename="(.+?)"/)? cd.match(/filename="(.+?)"/)[1] : `Sales_Report.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); await fetchSales();
  }catch(e){ console.error(e); alert('Error'); }
}

/* ===================== Orders UI (Advanced multi-item) ===================== */

function bindOrdersUI(){
  qs('#downloadOrdersXLSXBtnInline')?.addEventListener('click', downloadOrdersReportXLSX);
  qs('#downloadOrdersPDFBtn')?.addEventListener('click', ()=> window.open(`${API_BASE}/orders/report/pdf`, '_blank'));
  qs('#addOrderBtn')?.addEventListener('click', ()=> openOrderModal());
  qs('#ordersList')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset?.id;
    if (!id) return;
    if (btn.classList.contains('edit-order')) {
      openEditOrderModal(id);
    } else if (btn.classList.contains('cancel-order')) {
      if (!confirm('Cancel order?')) return;
      try {
        const res = await apiFetch(`${API_BASE}/orders/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'Cancelled' }) });
        if (res.ok) { await fetchOrders(); alert('Order cancelled'); } else alert('Failed');
      } catch (err) { console.error(err); alert('Server error'); }
    } else if (btn.classList.contains('delete-order')) {
      if (!confirm('Delete order?')) return;
      try {
        const res = await apiFetch(`${API_BASE}/orders/${id}`, { method: 'DELETE' });
        if (res.status === 204) { await fetchOrders(); alert('Deleted'); } else alert('Delete failed');
      } catch (err) { console.error(err); alert('Server error'); }
    } else if (btn.classList.contains('approve-order')) {
      if (!confirm('Approve order?')) return;
      try {
        const res = await apiFetch(`${API_BASE}/orders/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'Approved' }) });
        if (res.ok) { await fetchOrders(); alert('Order approved'); } else alert('Failed');
      } catch (err) { console.error(err); alert('Server error'); }
    }
  });
}

function renderOrders(rows){
  const t = qs('#ordersList'); if(!t) return;
  window.orders = rows;
  t.innerHTML = '';
  rows.forEach(o=>{
    const itemsSummary = (Array.isArray(o.items)? o.items.map(i=>`${i.name} x${i.qty}`).join(', '):'');
    const dateStr = o.date ? new Date(o.date).toLocaleString() : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(o.orderNumber)}</td><td>${escapeHtml(o.customerName)}</td><td>${escapeHtml(itemsSummary)}</td><td class="money">RM ${(Number(o.total)||0).toFixed(2)}</td><td>${escapeHtml(o.status)}</td><td>${dateStr}</td>
      <td class="actions">
        <button class="primary-btn small-btn edit-order" data-id="${o.id}">✏️ Edit</button>
        <button class="secondary-btn small-btn approve-order" data-id="${o.id}">✅ Approve</button>
        <button class="secondary-btn small-btn cancel-order" data-id="${o.id}">✖️ Cancel</button>
        <button class="danger-btn small-btn delete-order" data-id="${o.id}">🗑️ Delete</button>
      </td>`;
    t.appendChild(tr);
  });
}

/* Order modal (create/edit) - uses inventory items as choices */
function openOrderModal(initial = null) {
  if (!qs('#orderModal')) {
    const modal = document.createElement('div');
    modal.id = 'orderModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-inner" style="background:white;padding:20px;border-radius:8px;max-width:760px;margin:60px auto;">
        <h3 id="orderModalTitle">Create New Order</h3>
        <input id="order_id" type="hidden" />
        <label>Customer Name</label><input id="order_customer" />
        <div id="order_items_container" style="margin-top:12px;"></div>
        <button id="addOrderItemBtn" class="secondary-btn" style="margin-top:8px;">+ Add Item</button>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
          <label style="margin:0;">Total: RM <span id="order_total_display">0.00</span></label>
          <div style="flex:1"></div>
          <select id="order_status" style="margin-right:8px;"><option>Pending</option><option>Approved</option></select>
          <button id="saveOrderBtn" class="primary-btn">Save Order</button>
          <button id="orderModalClose" class="secondary-btn">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    qs('#addOrderItemBtn')?.addEventListener('click', addOrderItemRow);
    qs('#saveOrderBtn')?.addEventListener('click', saveOrderFromModal);
    qs('#orderModalClose')?.addEventListener('click',()=> qs('#orderModal').style.display='none');
  }
  // reset/add first row
  qs('#order_items_container').innerHTML = '';
  addOrderItemRow();
  qs('#order_customer').value = initial ? initial.customerName : '';
  qs('#order_id').value = initial ? initial.id : '';
  qs('#order_status').value = initial ? initial.status : 'Pending';
  qs('#order_total_display').textContent = initial ? (Number(initial.total)||0).toFixed(2) : '0.00';
  qs('#orderModalTitle').textContent = initial ? 'Edit Order' : 'Create New Order';
  qs('#orderModal').style.display = 'block';
}

function openEditOrderModal(id){
  const o = (window.orders || []).find(x => String(x.id) === String(id));
  if(!o) return alert('Order not found');
  openOrderModal(o);
}

function addOrderItemRow(item = {}) {
  const container = qs('#order_items_container');
  const row = document.createElement('div');
  row.className = 'order-item-row';
  row.style = 'display:flex;gap:8px;margin-top:8px;align-items:center;';
  row.innerHTML = `
    <input placeholder="SKU" class="order_sku" style="flex:1" value="${escapeHtml(item.sku||'')}" />
    <input placeholder="Name" class="order_name" style="flex:2" value="${escapeHtml(item.name||'')}" />
    <input placeholder="Qty" class="order_qty" type="number" min="1" value="${item.qty||1}" style="width:80px" />
    <input placeholder="Price" class="order_price" type="number" step="0.01" value="${(item.price||0).toFixed ? (item.price||0).toFixed(2) : (item.price||0)}" style="width:100px" />
    <button class="danger-btn removeItemBtn">Remove</button>
  `;
  container.appendChild(row);

  // when SKU or name typed, try to auto-fill price from inventory
  const skuInput = row.querySelector('.order_sku');
  const nameInput = row.querySelector('.order_name');
  const priceInput = row.querySelector('.order_price');
  const qtyInput = row.querySelector('.order_qty');

  function tryAutoFill() {
    const key = (skuInput.value || nameInput.value || '').toLowerCase();
    const match = inventory.find(it => (it.sku||'').toLowerCase() === key || (`${it.sku} - ${it.name}`||'').toLowerCase() === key || (it.name||'').toLowerCase().includes(key));
    if (match) {
      priceInput.value = (Number(match.unitPrice||match.unitCost||0)).toFixed(2);
      if(!nameInput.value) nameInput.value = `${match.name}`;
      if(!skuInput.value) skuInput.value = `${match.sku}`;
      updateOrderTotalFromModal();
    }
  }
  skuInput.addEventListener('input', tryAutoFill);
  nameInput.addEventListener('input', tryAutoFill);
  priceInput.addEventListener('input', updateOrderTotalFromModal);
  qtyInput.addEventListener('input', updateOrderTotalFromModal);
  row.querySelector('.removeItemBtn').addEventListener('click', ()=> { row.remove(); updateOrderTotalFromModal(); });

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
  const id = qs('#order_id')?.value;
  const customer = qs('#order_customer')?.value?.trim();
  const status = qs('#order_status')?.value || 'Pending';
  const rows = qsa('#order_items_container .order-item-row');
  if(!customer) return alert('Enter customer name');
  if(rows.length === 0) return alert('Add at least one item');
  const items = rows.map(r => ({ sku: r.querySelector('.order_sku')?.value?.trim(), name: r.querySelector('.order_name')?.value?.trim(), qty: Number(r.querySelector('.order_qty')?.value||0), price: Number(r.querySelector('.order_price')?.value||0) }));
  const total = items.reduce((s,i)=> s + (Number(i.qty||0) * Number(i.price||0)), 0);
  try {
    if(id) {
      const res = await apiFetch(`${API_BASE}/orders/${id}`, { method:'PUT', body: JSON.stringify({ customerName: customer, items, total, status }) });
      if(res.ok){ await fetchOrders(); qs('#orderModal').style.display='none'; alert('Order updated'); } else { const err = await res.json(); alert('Failed: ' + (err.message || '')); }
    } else {
      const res = await apiFetch(`${API_BASE}/orders`, { method:'POST', body: JSON.stringify({ customerName: customer, items, total, status }) });
      if(res.ok){ await fetchOrders(); qs('#orderModal').style.display='none'; alert('Order created'); } else { const err = await res.json(); alert('Failed: ' + (err.message || '')); }
    }
  } catch(e) { console.error(e); alert('Server error'); }
}

async function downloadOrdersReportXLSX(){
  try{
    const res = await apiFetch(`${API_BASE}/orders/report`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert(`Failed: ${err.message}`); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition'); const fn = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Orders_Report.xlsx`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); await fetchOrders();
  }catch(e){ console.error(e); alert('Error'); }
}

/* ===================== ZIP download for dashboard ===================== */
async function downloadAllReportsZip(){
  try{
    const res = await apiFetch(`${API_BASE}/reports/zip`, { method:'GET' });
    if(!res.ok){ const err = await res.json(); return alert(`Failed: ${err.message}`); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `All_Reports_${new Date().toISOString().slice(0,10)}.zip`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }catch(e){ console.error(e); alert('Error'); }
}

/* ===================== Settings, Logs bindings (basic) ================ */

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
      const data = await res.json();
      if(res.ok) {
        showMsg(msgEl, '✅ Password updated successfully! Please log in again.', 'green');
        qs('#newPassword').value = '';
        qs('#confirmPassword').value = '';
        qs('#securityCode').value = '';
        setTimeout(logout, 1500);
      } else {
        showMsg(msgEl, `❌ ${data.message || 'Failed to change password.'}`, 'red');
      }
    } catch(e) { showMsg(msgEl, '❌ Server connection failed during password change.', 'red'); }
  });

  qs('#deleteAccountBtn')?.addEventListener('click', async ()=> {
    if(!confirm(`⚠️ WARNING: Are you absolutely sure you want to delete the account for "${currentUsername}"?`)) return;
    const code = prompt('Enter Admin Security Code to CONFIRM account deletion:');
    if(!code) return alert('Deletion cancelled.');
    try {
      const res = await apiFetch(`${API_BASE}/account`, { method: 'DELETE', body: JSON.stringify({ username: currentUsername, securityCode: code }) });
      const data = await res.json();
      if(res.ok) { alert('🗑️ Account deleted successfully. You will now be logged out.'); logout(); }
      else alert(`❌ ${data.message || 'Failed to delete account.'}`);
    } catch(e) { alert('❌ Server connection failed during account deletion.'); }
  });
}

/* DOM login/register bindings */
document.addEventListener('DOMContentLoaded', ()=> {
  if(currentPage.includes('login.html')) {
    qs('#loginBtn')?.addEventListener('click', async ()=>{
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
    });

    qs('#registerBtn')?.addEventListener('click', async ()=>{
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
    });

    qs('#toggleToRegister')?.addEventListener('click', toggleForm);
    qs('#toggleToLogin')?.addEventListener('click', toggleForm);

    if (qs('#contactPhone') && window.CONFIG && CONFIG.CONTACT_PHONE) qs('#contactPhone').textContent = CONFIG.CONTACT_PHONE;
  }
});

/* helper toggle register/login form */
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

/* expose some functions for inline onclick handlers */
window.logout = logout;
window.toggleTheme = toggleTheme;
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadSalesReportXLSX = downloadSalesReportXLSX;
window.downloadOrdersReportXLSX = downloadOrdersReportXLSX;
window.downloadAllReportsZip = downloadAllReportsZip;
window.drawInventoryChart = drawInventoryChart;
