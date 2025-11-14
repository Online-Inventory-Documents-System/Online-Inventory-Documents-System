// public/js/script.js
// Client-side script (updated) — supports XLSX/PDF/ZIP downloads and dashboard Chart.js
const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [], activityLog = [], documents = [], orders = [], sales = [];
const currentPage = window.location.pathname.split('/').pop();

async function apiFetch(url, options = {}) {
  const user = getUsername();
  options.headers = {
    'Content-Type': 'application/json',
    'X-Username': user,
    ...options.headers
  };
  return fetch(url, options);
}

if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')){
  try { window.location.href = 'login.html'; } catch(e) {}
}

function logout(){
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('adminName');
  window.location.href = 'login.html';
}
window.logout = logout;

function toggleTheme(){
  document.body.classList.toggle('dark-mode');
  if(window.CONFIG && CONFIG.LS_THEME) localStorage.setItem(CONFIG.LS_THEME, document.body.classList.contains('dark-mode') ? 'dark' : 'light');
}
window.toggleTheme = toggleTheme;

// -------- RENDERERS --------
function renderInventory(items){
  const listEl = qs('#inventoryList');
  if(!listEl) return;
  listEl.innerHTML = '';
  let totalValue=0, totalRevenue=0, totalStock=0;

  items.forEach(it=>{
    const id = it.id || it._id;
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const invVal = qty*uc, rev = qty*up;
    totalValue += invVal; totalRevenue += rev; totalStock += qty;
    const tr = document.createElement('tr');
    if(qty===0) tr.classList.add('out-of-stock-row'); else if(qty<10) tr.classList.add('low-stock-row');
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

function renderOrders(list){
  const el = qs('#ordersList'); if(!el) return;
  el.innerHTML = '';
  list.forEach(o=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(o.orderNumber)}</td><td>${escapeHtml(o.customerName)}</td><td>${(o.items||[]).length}</td><td class="money">RM ${Number(o.total||0).toFixed(2)}</td><td>${escapeHtml(o.status)}</td><td>${new Date(o.createdAt).toLocaleString()}</td>`;
    el.appendChild(tr);
  });
}

function renderSales(list){
  const el = qs('#salesList'); if(!el) return;
  el.innerHTML = '';
  list.forEach(s=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(s.invoice)}</td><td>${(s.items||[]).map(i=>escapeHtml(i.name)).join(', ')}</td><td>${(s.items||[]).reduce((a,b)=>a+(b.qty||0),0)}</td><td class="money">RM ${Number(s.total||0).toFixed(2)}</td><td>${new Date(s.date).toLocaleString()}</td>`;
    el.appendChild(tr);
  });
}

function renderDocuments(docs){
  const listEl = qs('#docList'); if(!listEl) return;
  listEl.innerHTML = '';
  docs.forEach(d=>{
    const tr = document.createElement('tr');
    const sizeMB = ((d.sizeBytes||d.size||0)/(1024*1024)).toFixed(2);
    tr.innerHTML = `<td>${escapeHtml(d.name)}</td><td>${sizeMB} MB</td><td>${new Date(d.date).toLocaleString()}</td><td class="actions"><button class="primary-btn small-btn" onclick="downloadDocument('${encodeURIComponent(d.name)}')">⬇️ Download</button><button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${d.id||d._id}')">🗑️ Delete</button></td>`;
    listEl.appendChild(tr);
  });
}

function renderLogs(){
  const list = qs('#logList'); if(!list) return;
  list.innerHTML = '';
  activityLog.forEach(l=>{
    const li = document.createElement('li');
    const timeStr = l.time ? new Date(l.time).toLocaleString() : new Date().toLocaleString();
    li.innerHTML = `[${escapeHtml(timeStr)}] <b>${escapeHtml(l.user||'System')}</b>: ${escapeHtml(l.action||'')}`;
    list.appendChild(li);
  });
  renderDashboardData();
}

function renderDashboardData(){
  if(qs('#dash_totalItems')){
    let totalValue=0, totalRevenue=0, totalStock=0;
    inventory.forEach(it=>{
      const q = Number(it.quantity||0);
      totalValue += q * Number(it.unitCost||0);
      totalRevenue += q * Number(it.unitPrice||0);
      totalStock += q;
    });
    qs('#dash_totalItems').textContent = inventory.length;
    qs('#dash_totalValue').textContent = totalValue.toFixed(2);
    qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
    qs('#dash_totalStock').textContent = totalStock;
  }

  // fill recentActivities table if present
  if(qs('#recentActivities')){
    const tbody = qs('#recentActivities');
    tbody.innerHTML = '';
    activityLog.slice(0,5).forEach(l=>{
      const tr = document.createElement('tr');
      const timeStr = l.time ? new Date(l.time).toLocaleString() : new Date().toLocaleString();
      tr.innerHTML = `<td>${escapeHtml(l.user||'Admin')}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(timeStr)}</td>`;
      tbody.appendChild(tr);
    });
  }

  // render dashboard chart if canvas exists
  if(currentPage === '' || currentPage === 'index.html'){
    ensureChartRendered();
  }
}

// -------- FETCHERS --------
async function fetchInventory(){ try {
  const res = await apiFetch(`${API_BASE}/inventory`);
  if(!res.ok) throw new Error('Fetch inventory failed');
  inventory = await res.json();
  inventory = inventory.map(i=>({ ...i, id: i.id || i._id }));
  renderInventory(inventory);
  renderDashboardData();
} catch(e){ console.error(e); } }

async function fetchDocuments(){ try {
  const res = await apiFetch(`${API_BASE}/documents`);
  if(!res.ok) throw new Error('Fetch documents failed');
  documents = await res.json();
  documents = documents.map(d=>({ ...d, id: d.id || d._id }));
  renderDocuments(documents);
} catch(e){ console.error(e); } }

async function fetchLogs(){ try {
  const res = await apiFetch(`${API_BASE}/logs`);
  if(!res.ok) throw new Error('Fetch logs failed');
  activityLog = await res.json();
  renderLogs();
} catch(e){ console.error(e); } }

async function fetchOrders(){ try {
  const res = await apiFetch(`${API_BASE}/orders`);
  if(!res.ok) throw new Error('Fetch orders failed');
  orders = await res.json();
  orders = orders.map(o=>({ ...o, id: o.id || o._id }));
  renderOrders(orders);
} catch(e){ console.error(e); } }

async function fetchSales(){ try {
  const res = await apiFetch(`${API_BASE}/sales`);
  if(!res.ok) throw new Error('Fetch sales failed');
  sales = await res.json();
  sales = sales.map(s=>({ ...s, id: s.id || s._id }));
  renderSales(sales);
} catch(e){ console.error(e); } }

// -------- INIT --------
window.addEventListener('load', async ()=>{
  const adminName = getUsername();
  if(qs('#adminName')) qs('#adminName').textContent = adminName;
  if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
  if(currentPage.includes('documents')) { await fetchDocuments(); bindDocumentsUI(); }
  if(currentPage.includes('log') || currentPage === '' || currentPage === 'index.html') { await fetchLogs(); await fetchInventory(); }
  if(currentPage.includes('product')) bindProductPage();
  if(currentPage.includes('sales')) { await fetchSales(); bindSalesUI(); }
  if(currentPage.includes('orders')) { await fetchOrders(); bindOrdersUI(); }
  if(currentPage.includes('setting')) bindSettingPage();
  // hook global download buttons if present
  hookDownloadButtons();
});

// -------- AUTH (login/register) --------
async function login(){ const user=qs('#username')?.value?.trim(); const pass=qs('#password')?.value?.trim(); const msg=qs('#loginMessage'); showMsg(msg,''); if(!user||!pass){ showMsg(msg,'⚠️ Enter username & password'); return; }
  try{
    const res = await apiFetch(`${API_BASE}/login`, { method:'POST', body: JSON.stringify({ username:user,password:pass }) });
    const data = await res.json();
    if(res.ok){ sessionStorage.setItem('isLoggedIn','true'); sessionStorage.setItem('adminName', user); showMsg(msg,'✅ Login successful','green'); setTimeout(()=>window.location.href='index.html',700); } else { showMsg(msg,`❌ ${data.message||'Login failed'}`,'red'); }
  } catch(e){ showMsg(msg,'❌ Server error','red'); console.error(e); }
}
async function register(){ const user=qs('#newUsername')?.value?.trim(); const pass=qs('#newPassword')?.value?.trim(); const code=qs('#securityCode')?.value?.trim(); const msg=qs('#registerMessage'); showMsg(msg,''); if(!user||!pass||!code){ showMsg(msg,'⚠️ Fill all fields','red'); return; }
  try{ const res = await apiFetch(`${API_BASE}/register`, { method:'POST', body: JSON.stringify({ username:user,password:pass,securityCode:code }) }); const data = await res.json(); if(res.ok){ showMsg(msg,'✅ Registered! Login now','green'); setTimeout(()=>toggleForm(),900);} else showMsg(msg,`❌ ${data.message||'Registration failed'}`,'red'); } catch(e){ showMsg(msg,'❌ Server error','red'); console.error(e); }
}
function toggleForm(){ const loginForm=qs('#loginForm'), registerForm=qs('#registerForm'), formTitle=qs('#formTitle'); if(!loginForm||!registerForm||!formTitle) return; if(getComputedStyle(loginForm).display==='none'){ loginForm.style.display='block'; registerForm.style.display='none'; formTitle.textContent='🔐 Admin Login'; } else { loginForm.style.display='none'; registerForm.style.display='block'; formTitle.textContent='🧾 Register Account'; } }

// -------- INVENTORY CRUD (add/edit/delete) --------
async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value?.trim();
  const name = qs('#p_name')?.value?.trim();
  const category = qs('#p_category')?.value?.trim();
  const quantity = Number(qs('#p_quantity')?.value || 0);
  const unitCost = Number(qs('#p_unitCost')?.value || 0);
  const unitPrice = Number(qs('#p_unitPrice')?.value || 0);
  if(!sku||!name) return alert('Enter SKU & Name');
  if(!confirm(`Add Product: ${name} (${sku})?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory`, { method:'POST', body: JSON.stringify({ sku,name,category,quantity,unitCost,unitPrice }) });
    if(res.ok){ ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id=>{ if(qs(id)) qs(id).value=''; }); await fetchInventory(); alert('✅ Product added'); } else { alert('❌ Failed to add product'); }
  } catch(e){ console.error(e); alert('❌ Server error'); }
}

async function confirmAndDeleteItem(id){
  const it = inventory.find(x=>String(x.id)===String(id));
  if(!it) return;
  if(!confirm(`Delete "${it.name}"?`)) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method:'DELETE' });
    if(res.status===204){ await fetchInventory(); alert('🗑️ Item deleted'); } else alert('❌ Delete failed');
  } catch(e){ console.error(e); alert('❌ Server error'); }
}

async function confirmAndGenerateReport(){
  if(!confirm('Generate Excel report?')) return;
  try{
    const res = await apiFetch(`${API_BASE}/inventory/report`, { method:'GET' });
    if(res.ok){
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition');
      const fnMatch = cd ? cd.match(/filename="(.+?)"/) : null;
      const filename = fnMatch ? fnMatch[1] : `Inventory_Report_${Date.now()}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.style.display='none'; a.href=url; a.download=filename; document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(url); a.remove();
      await fetchDocuments(); alert(`Report "${filename}" generated`); 
    } else { const err = await res.json(); alert(`Failed: ${err.message||'Unknown'}`); }
  } catch(e){ console.error(e); alert('Report error'); }
}

// bind inventory UI
function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct);
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport);
  qs('#searchInput')?.addEventListener('input', searchInventory);
  qs('#clearSearchBtn')?.addEventListener('click', ()=>{ if(qs('#searchInput')) { qs('#searchInput').value=''; searchInventory(); }});
}

// search
function searchInventory(){
  const q = (qs('#searchInput')?.value||'').toLowerCase().trim();
  const filtered = inventory.filter(item => (item.sku||'').toLowerCase().includes(q) || (item.name||'').toLowerCase().includes(q) || (item.category||'').toLowerCase().includes(q));
  renderInventory(filtered);
}

// product page
function openEditPageForItem(id){ window.location.href = `product.html?id=${encodeURIComponent(id)}`; }
async function bindProductPage(){
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if(id){ try{ const res = await apiFetch(`${API_BASE}/inventory`); const items = await res.json(); const it = items.find(x=>String(x.id)===String(id)); if(!it){ alert('Item not found'); return; } if(qs('#prod_id')) qs('#prod_id').value = it.id||it._id; if(qs('#prod_sku')) qs('#prod_sku').value = it.sku||''; if(qs('#prod_name')) qs('#prod_name').value = it.name||''; if(qs('#prod_category')) qs('#prod_category').value = it.category||''; if(qs('#prod_quantity')) qs('#prod_quantity').value = it.quantity||0; if(qs('#prod_unitCost')) qs('#prod_unitCost').value = it.unitCost||0; if(qs('#prod_unitPrice')) qs('#prod_unitPrice').value = it.unitPrice||0; } catch(e){ alert('Failed to load product'); return; } }

  qs('#saveProductBtn')?.addEventListener('click', async ()=>{
    if(!confirm('Save changes?')) return;
    const idVal = qs('#prod_id')?.value;
    const body = { sku: qs('#prod_sku')?.value, name: qs('#prod_name')?.value, category: qs('#prod_category')?.value, quantity: Number(qs('#prod_quantity')?.value||0), unitCost: Number(qs('#prod_unitCost')?.value||0), unitPrice: Number(qs('#prod_unitPrice')?.value||0) };
    try{ const res = await apiFetch(`${API_BASE}/inventory/${idVal}`, { method:'PUT', body: JSON.stringify(body) }); if(res.ok){ alert('✅ Item updated'); window.location.href='inventory.html'; } else { const err = await res.json(); alert('❌ Update failed: '+(err.message||'Unknown')) } } catch(e){ console.error(e); alert('❌ Server error'); }
  });
  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href='inventory.html');
}

// documents
async function uploadDocuments(){
  const files = qs('#docUpload')?.files || [];
  let msgEl = qs('#uploadMessage');
  if(!msgEl){ msgEl = document.createElement('p'); msgEl.id='uploadMessage'; if(qs('.controls')) qs('.controls').appendChild(msgEl); }
  if(files.length===0){ showMsg(msgEl,'⚠️ Select files','red'); return; }
  if(!confirm(`Upload metadata for ${files.length} document(s)?`)){ showMsg(msgEl,'Cancelled','orange'); return; }
  showMsg(msgEl,`Uploading ${files.length} document(s)...`,'orange');
  for(let f of files){
    const meta = { name:f.name, type:f.type, sizeBytes: f.size };
    try {
      const res = await apiFetch(`${API_BASE}/documents`, { method:'POST', body: JSON.stringify(meta) });
      if(!res.ok) throw new Error('Server error');
      showMsg(msgEl,`✅ Uploaded ${f.name}`,'green');
    } catch(e){ console.error(e); showMsg(msgEl,`❌ Failed ${f.name}`,'red'); return; }
  }
  if(qs('#docUpload')) qs('#docUpload').value = '';
  setTimeout(async ()=>{ await fetchDocuments(); if(msgEl) msgEl.remove(); },1000);
}
function downloadDocument(fileNameEncoded){ const fileName = decodeURIComponent(fileNameEncoded); if(!confirm(`Download: ${fileName}?`)) return; window.open(`${API_BASE}/documents/download/${encodeURIComponent(fileName)}`,'_blank'); }
async function deleteDocumentConfirm(id){ const doc = documents.find(d=>String(d.id)===String(id)); if(!doc) return; if(confirm(`Delete document metadata for "${doc.name}"?`)) await deleteDocument(id); }
async function deleteDocument(id){ try{ const res = await apiFetch(`${API_BASE}/documents/${id}`, { method:'DELETE' }); if(res.status===204 || res.ok){ await fetchDocuments(); alert('🗑️ Document deleted'); } else alert('❌ Delete failed'); } catch(e){ console.error(e); alert('❌ Server error'); } }
function searchDocuments(){ const q = (qs('#searchDocs')?.value||'').toLowerCase().trim(); const filtered = documents.filter(d=> (d.name||'').toLowerCase().includes(q) || (d.date? new Date(d.date).toLocaleString().toLowerCase() : '').includes(q)); renderDocuments(filtered); }
function bindDocumentsUI(){ qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments); qs('#searchDocs')?.addEventListener('input', searchDocuments); }

// orders & sales UI binding
function bindOrdersUI(){ qs('#downloadOrdersXLSXBtnInline')?.addEventListener('click', downloadOrdersReportXLSX); qs('#downloadOrdersPDFBtn')?.addEventListener('click', ()=>downloadOrdersPDF()); }
function bindSalesUI(){ qs('#downloadSalesXLSXBtnInline')?.addEventListener('click', downloadSalesReportXLSX); qs('#downloadSalesPDFBtn')?.addEventListener('click', ()=>downloadSalesPDF()); }

// settings
function bindSettingPage(){
  const currentUsername = getUsername();
  if(qs('#currentUser')) qs('#currentUser').textContent = currentUsername;
  qs('#changePasswordBtn')?.addEventListener('click', async ()=>{
    const newPass = qs('#newPassword')?.value, conf = qs('#confirmPassword')?.value, code = qs('#securityCode')?.value;
    const msgEl = qs('#passwordMessage'); showMsg(msgEl,'');
    if(!newPass||!conf||!code) return showMsg(msgEl,'⚠️ Fill all fields','red');
    if(newPass!==conf) return showMsg(msgEl,'⚠️ Passwords do not match','red');
    if(!confirm('Change password? You will be logged out after.')) return;
    try{
      const res = await apiFetch(`${API_BASE}/account/password`, { method:'PUT', body: JSON.stringify({ username: currentUsername, newPassword: newPass, securityCode: code }) });
      const data = await res.json();
      if(res.ok){ showMsg(msgEl,'✅ Password updated. Logging out','green'); setTimeout(logout,1500); } else showMsg(msgEl,`❌ ${data.message||'Failed'}`,'red');
    } catch(e){ showMsg(msgEl,'❌ Server error','red'); }
  });
  qs('#deleteAccountBtn')?.addEventListener('click', async ()=> {
    if(!confirm('Delete your account?')) return;
    const code = prompt('Enter Admin Security Code:');
    if(!code) return alert('Cancelled');
    try{
      const res = await apiFetch(`${API_BASE}/account`, { method:'DELETE', body: JSON.stringify({ username: currentUsername, securityCode: code }) });
      const data = await res.json();
      if(res.ok){ alert('🗑️ Account deleted'); logout(); } else alert(`❌ ${data.message||'Failed'}`);
    } catch(e){ alert('❌ Server error'); }
  });
}

// -------- REPORT DOWNLOAD HELPERS (PDF / XLSX / ZIP) --------
async function downloadInventoryPDF(){
  window.open(`${API_BASE}/inventory/report/pdf`, '_blank');
}
async function downloadSalesPDF(){
  window.open(`${API_BASE}/sales/report/pdf`, '_blank');
}
async function downloadOrdersPDF(){
  window.open(`${API_BASE}/orders/report/pdf`, '_blank');
}
async function downloadAllReportsZip(){
  window.open(`${API_BASE}/reports/zip`, '_blank');
}

// XLSX download helpers for sales/orders (calls server endpoints)
async function downloadSalesReportXLSX(){
  try{
    const res = await apiFetch(`${API_BASE}/sales/report`, { method:'GET' });
    if(!res.ok) { const err = await res.json(); return alert('Failed: '+(err.message||'Unknown')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    const filename = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Sales_Report_${Date.now()}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch(e){ console.error(e); alert('Download failed'); }
}
async function downloadOrdersReportXLSX(){
  try{
    const res = await apiFetch(`${API_BASE}/orders/report`, { method:'GET' });
    if(!res.ok) { const err = await res.json(); return alert('Failed: '+(err.message||'Unknown')); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    const filename = cd && cd.match(/filename="(.+?)"/) ? cd.match(/filename="(.+?)"/)[1] : `Orders_Report_${Date.now()}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch(e){ console.error(e); alert('Download failed'); }
}

// -------- Hook global download buttons present on pages --------
function hookDownloadButtons(){
  // Inventory page PDF/XLSX
  const invPdfBtn = qs('#downloadInventoryPDFBtn') || qs('#downloadInventoryPDFBtnInline');
  const invXlsxBtn = qs('#reportBtn') || qs('#downloadInventoryXLSXBtnInline');
  if(invPdfBtn) invPdfBtn.addEventListener('click', ()=>downloadInventoryPDF());
  if(invXlsxBtn) invXlsxBtn.addEventListener('click', ()=>confirmAndGenerateReport());

  // Sales page
  const salesPdf = qs('#downloadSalesPDFBtn') || qs('#downloadSalesPDFBtnInline');
  const salesXls = qs('#downloadSalesXLSXBtnInline');
  if(salesPdf) salesPdf.addEventListener('click', ()=>downloadSalesPDF());
  if(salesXls) salesXls.addEventListener('click', ()=>downloadSalesReportXLSX());

  // Orders page
  const ordersPdf = qs('#downloadOrdersPDFBtn') || qs('#downloadOrdersPDFBtnInline');
  const ordersXls = qs('#downloadOrdersXLSXBtnInline');
  if(ordersPdf) ordersPdf.addEventListener('click', ()=>downloadOrdersPDF());
  if(ordersXls) ordersXls.addEventListener('click', ()=>downloadOrdersReportXLSX());

  // Dashboard ZIP/Excel/PDF if present
  const zipBtn = qs('#downloadAllReportsZipBtn');
  if(zipBtn) zipBtn.addEventListener('click', ()=>downloadAllReportsZip());
}

// -------- Chart.js dynamic load + render --------
let _chartInstance = null;
async function ensureChartRendered(){
  // look for canvas element id=inventoryChart
  const canvas = qs('#inventoryChart');
  if(!canvas) return;
  // load Chart.js dynamically if not present
  if(typeof Chart === 'undefined'){
    await new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    }).catch(err=>{ console.warn('Chart.js failed to load', err); });
  }
  // prepare data
  const labels = inventory.map(i=>i.name || i.sku || 'Unnamed');
  const data = inventory.map(i=>Number(i.quantity||0));
  // destroy existing chart if any
  if(_chartInstance){ try{ _chartInstance.destroy(); }catch(e){} _chartInstance=null; }
  try{
    const ctx = canvas.getContext('2d');
    _chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Stock Quantity', data, backgroundColor: 'rgba(54, 162, 235, 0.6)' }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero:true } }
      }
    });
  } catch(e){ console.error('Chart render failed', e); }
}

// -------- Expose globals used by inline onclick attributes in HTML --------
window.openEditPageForItem = openEditPageForItem;
window.confirmAndDeleteItem = confirmAndDeleteItem;
window.downloadDocument = downloadDocument;
window.deleteDocumentConfirm = deleteDocumentConfirm;
window.downloadInventoryPDF = downloadInventoryPDF;
window.downloadSalesPDF = downloadSalesPDF;
window.downloadOrdersPDF = downloadOrdersPDF;
window.downloadAllReportsZip = downloadAllReportsZip;
window.downloadSalesReportXLSX = downloadSalesReportXLSX;
window.downloadOrdersReportXLSX = downloadOrdersReportXLSX;

// -------- DOMContentLoaded small bindings for login/register pages --------
document.addEventListener('DOMContentLoaded', ()=> {
  if(currentPage.includes('login.html')){
    qs('#loginBtn')?.addEventListener('click', login);
    qs('#registerBtn')?.addEventListener('click', register);
    qs('#toggleToRegister')?.addEventListener('click', toggleForm);
    qs('#toggleToLogin')?.addEventListener('click', toggleForm);
    if(qs('#contactPhone') && window.CONFIG && CONFIG.CONTACT_PHONE) qs('#contactPhone').textContent = CONFIG.CONTACT_PHONE;
  }
});
