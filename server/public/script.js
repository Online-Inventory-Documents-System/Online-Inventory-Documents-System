// client/js/script.js - FULLY API VERSION (READY TO DEPLOY)

// ⚠️ Automatically set API_BASE depending on environment
const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api/test"; // <- Replace with your Render app

// ====== Utilities ======
function qs(sel){ return document.querySelector(sel); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }
function showMsg(el, text, color='red'){ if(!el) return; el.textContent = text; el.style.color = color; }
function escapeHtml(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

// Global state
let inventory = [];
let activityLog = [];
let documents = [];
const currentPage = window.location.pathname.split('/').pop();

// ====== Standard Fetch Wrapper with Authorization Header ======
async function apiFetch(url, options = {}) {
    const user = getUsername();
    options.headers = {
        'Content-Type': 'application/json',
        'X-Username': user,
        ...options.headers
    };
    return fetch(url, options);
}

// ====== Auth redirect & Globals ======
if(!sessionStorage.getItem('isLoggedIn') && !window.location.pathname.includes('login.html')) {
  window.location.href = 'login.html';
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

// INVENTORY RENDERER
function renderInventory(items) {
    const listEl = qs('#inventoryList');
    if (!listEl) return;
    
    listEl.innerHTML = ''; 
    let totalValue = 0;
    let totalRevenue = 0;
    let totalStock = 0;

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
        row.dataset.id = item.id;
        
        if (qty === 0) { row.classList.add('out-of-stock-row'); } 
        else if (qty < 10) { row.classList.add('low-stock-row'); }
        
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

// DOCUMENTS RENDERER
function renderDocuments(docs) {
    const listEl = qs('#docList');
    if (!listEl) return;
    
    listEl.innerHTML = ''; 
    docs.forEach(doc => {
        const id = doc.id;
        const sizeBytes = doc.sizeBytes || doc.size; 
        const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2); 
        const row = document.createElement('tr');
        row.dataset.id = id;
        const fileName = doc.name;
        
        row.innerHTML = `
            <td>${escapeHtml(fileName)}</td>
            <td>${sizeMB} MB</td>
            <td>${new Date(doc.date).toLocaleString()}</td>
            <td class="actions">
                <button class="primary-btn small-btn" onclick="downloadDocument('${fileName}')">⬇️ Download</button>
                <button class="danger-btn small-btn" onclick="deleteDocumentConfirm('${id}')">🗑️ Delete</button>
            </td>
        `;
        listEl.appendChild(row);
    });
}

// ACTIVITY LOG RENDERER
function renderLogs() {
    const listEl = qs('#logList');
    if (!listEl) return;
    
    listEl.innerHTML = ''; 
    const reversedLog = [...activityLog].reverse(); 
    reversedLog.forEach(log => {
        const item = document.createElement('li');
        item.innerHTML = `[${escapeHtml(log.time)}] <b>${escapeHtml(log.user)}</b>: ${escapeHtml(log.action)}`;
        listEl.appendChild(item);
    });
    
    renderDashboardData();
}

// DASHBOARD RENDERER
function renderDashboardData(){
  const tbody = qs('#recentActivities');
  if(tbody) {
    tbody.innerHTML = '';
    activityLog.slice().reverse().slice(0, 5).forEach(log => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(log.user || 'Admin')}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.time)}</td>`;
      tbody.appendChild(tr);
    });
  }

  if(qs('#dash_totalItems')) {
    const totalItems = inventory.length;
    let totalValue = 0;
    let totalRevenue = 0;
    let totalStock = 0;

    inventory.forEach(item => {
        const qty = Number(item.quantity || 0);
        const uc = Number(item.unitCost || 0);
        const up = Number(item.unitPrice || 0);
        totalValue += qty * uc;
        totalRevenue += qty * up;
        totalStock += qty;
    });

    qs('#dash_totalItems').textContent = totalItems;
    qs('#dash_totalValue').textContent = totalValue.toFixed(2);
    qs('#dash_totalRevenue').textContent = totalRevenue.toFixed(2);
    qs('#dash_totalStock').textContent = totalStock;
}

// ====== Data Fetchers ======
async function fetchInventory() { try { const res = await apiFetch(`${API_BASE}/inventory`); inventory = await res.json(); renderInventory(inventory); renderDashboardData(); } catch(e){ console.error('Failed to fetch inventory:', e); } }
async function fetchDocuments() { try { const res = await apiFetch(`${API_BASE}/documents`); documents = await res.json(); renderDocuments(documents); } catch(e){ console.error('Failed to fetch documents:', e); } }
async function fetchLogs() { try { const res = await apiFetch(`${API_BASE}/logs`); activityLog = await res.json(); renderLogs(); } catch(e){ console.error('Failed to fetch logs:', e); } }

// ====== On load init ======
window.addEventListener('load', async () => {
    const adminName = getUsername();
    if(qs('#adminName')) qs('#adminName').textContent = adminName;
    const theme = window.CONFIG && CONFIG.LS_THEME ? localStorage.getItem(CONFIG.LS_THEME) : null;
    if(theme === 'dark') document.body.classList.add('dark-mode');

    if(currentPage.includes('inventory')) { await fetchInventory(); bindInventoryUI(); }
    if(currentPage.includes('documents')) { await fetchDocuments(); bindDocumentsUI(); }
    if(currentPage.includes('log')) { await fetchLogs(); }
    if(currentPage.includes('index.html') || currentPage === '' || currentPage === 'index.html') { await fetchLogs(); await fetchInventory(); }
    if(currentPage.includes('product')) bindProductPage();
    if(currentPage.includes('setting')) bindSettingPage();
});

// ====== AUTH (Unchanged) ======
async function login(){
  const user = qs('#username')?.value.trim();
  const pass = qs('#password')?.value.trim();
  const msg = qs('#loginMessage');
  showMsg(msg, '');
  if(!user||!pass){ showMsg(msg, '⚠️ Please enter username and password.', 'red'); return; }

  try {
      const res = await apiFetch(`${API_BASE}/login`, { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
      const data = await res.json();
      if(res.ok){
          sessionStorage.setItem('isLoggedIn','true');
          sessionStorage.setItem('adminName', user);
          showMsg(msg, '✅ Login successful! Redirecting...', 'green');
          setTimeout(()=> window.location.href = 'index.html', 700);
      } else {
          showMsg(msg, `❌ ${data.message || 'Login failed.'}`, 'red');
      }
  } catch(e){ showMsg(msg, '❌ Server connection failed.', 'red'); }
}

async function register(){
  const user = qs('#newUsername')?.value.trim();
  const pass = qs('#newPassword')?.value.trim();
  const code = qs('#securityCode')?.value.trim(); 
  const msg = qs('#registerMessage');
  showMsg(msg, '');
  if(!user||!pass||!code){ showMsg(msg, '⚠️ Please fill in all fields.', 'red'); return; }
  
  try {
      const res = await apiFetch(`${API_BASE}/register`, { method: 'POST', body: JSON.stringify({ username: user, password: pass, securityCode: code }) });
      const data = await res.json();
      if(res.ok){
          showMsg(msg, '✅ Registered successfully! You can now log in.', 'green');
          setTimeout(()=> toggleForm(), 900);
      } else {
          showMsg(msg, `❌ ${data.message || 'Registration failed.'}`, 'red');
      }
  } catch(e){ showMsg(msg, '❌ Server connection failed.', 'red'); }
}

function toggleForm(){
  const loginForm = qs('#loginForm');
  const registerForm = qs('#registerForm');
  const formTitle = qs('#formTitle');
  if(getComputedStyle(loginForm).display === 'none'){
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    formTitle.textContent = '🔐 Admin Login';
  } else {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
    formTitle.textContent = '🧾 Register Account';
  }
}

document.addEventListener('DOMContentLoaded', () => {
    // Bindings (Login page only)
    if(currentPage.includes('login.html')){
        qs('#loginBtn')?.addEventListener('click', login);
        qs('#registerBtn')?.addEventListener('click', register);
        qs('#toggleToRegister')?.addEventListener('click', toggleForm);
        qs('#toggleToLogin')?.addEventListener('click', toggleForm);
        if (qs('#contactPhone')) qs('#contactPhone').textContent = CONFIG.CONTACT_PHONE;
    }
});


// ====== INVENTORY LOGIC (Confirmation logic) ======

// NEW: Add product with confirmation dialog
async function confirmAndAddProduct(){
  const sku = qs('#p_sku')?.value.trim();
  const name = qs('#p_name')?.value.trim();
  const category = qs('#p_category')?.value.trim();
  const quantity = parseInt(qs('#p_quantity')?.value || 0, 10);
  const unitCost = parseFloat(qs('#p_unitCost')?.value || 0);
  const unitPrice = parseFloat(qs('#p_unitPrice')?.value || 0);
  if(!sku || !name) return alert('Please enter SKU and Name.');

  if (!window.confirm(`Confirm Add Product: ${name} (${sku})?`)) return;

  const newItem = { sku, name, category, quantity, unitCost, unitPrice };
  try {
      const res = await apiFetch(`${API_BASE}/inventory`, { method: 'POST', body: JSON.stringify(newItem) });
      if(res.ok){
        ['#p_sku','#p_name','#p_category','#p_quantity','#p_unitCost','#p_unitPrice'].forEach(id => { if(qs(id)) qs(id).value=''; });
        await fetchInventory(); 
        // Added this to ensure log data is refreshed on inventory page after adding an item
        if(currentPage.includes('inventory')) await fetchLogs(); 
        alert('✅ Product added successfully.');
      } else {
        alert('❌ Failed to add product.');
      }
  } catch(e){ console.error(e); alert('❌ Server connection error while adding product.'); }
}

// NEW: Delete item with confirmation dialog
async function confirmAndDeleteItem(id){
  const item = inventory.find(x => x.id === id);
  if(!item) return;
  
  if(!window.confirm(`Confirm Delete: "${item.name}"?`)) return;

  try {
      const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method: 'DELETE' });
      if(res.status === 204){
        await fetchInventory(); 
        alert('🗑️ Item deleted!');
      } else {
        alert('❌ Failed to delete item.');
      }
  } catch(e){ console.error(e); alert('❌ Server connection error while deleting product.'); }
}

// NEW: Generate report with confirmation dialog
async function confirmAndGenerateReport() {
    if(!window.confirm('Confirm Generate Report: This will create and save a new Excel file.')) return;

    try {
        const res = await apiFetch(`${API_BASE}/inventory/report`, { method: 'GET' });

        if (res.ok) {
            const blob = await res.blob();
            // Try to extract filename from Content-Disposition header
            const contentDisposition = res.headers.get('Content-Disposition');
            const filenameMatch = contentDisposition ? contentDisposition.match(/filename="(.+?)"/) : null;
            const filename = filenameMatch ? filenameMatch[1] : `Inventory_Report_${Date.now()}.xlsx`;
            
            // Trigger file download
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            
            // The server is responsible for logging and updating the documents list.
            // A simple refresh will pull the updated documents.
            await fetchDocuments(); 
            
            alert(`Report "${filename}" successfully generated and saved to Documents!`);

        } else {
            const error = await res.json();
            alert(`Failed to generate report: ${error.message}`);
        }
    } catch (e) {
        console.error('Report generation error:', e);
        alert('An error occurred during report generation. Check console for details.');
    }
}

function bindInventoryUI(){
  qs('#addProductBtn')?.addEventListener('click', confirmAndAddProduct); 
  qs('#reportBtn')?.addEventListener('click', confirmAndGenerateReport); 
  qs('#searchInput')?.addEventListener('input', searchInventory);
  qs('#clearSearchBtn')?.addEventListener('click', ()=> { qs('#searchInput').value=''; searchInventory(); });
}

function searchInventory() {
    const query = qs('#searchInput')?.value.toLowerCase().trim();
    const filtered = inventory.filter(item => 
        item.sku.toLowerCase().includes(query) || 
        item.name.toLowerCase().includes(query) || 
        item.category.toLowerCase().includes(query)
    );
    renderInventory(filtered);
}


// ====== PRODUCT PAGE (EDIT) - MODIFIED Save button ======
function openEditPageForItem(id){
  window.location.href = `product.html?id=${encodeURIComponent(id)}`;
}

async function bindProductPage(){
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  
  if(id){
    try{
        const res = await apiFetch(`${API_BASE}/inventory`);
        const items = await res.json();
        const it = items.find(x => String(x.id) === String(id));
        if(!it) { alert('Item not found'); return; }
        
        qs('#prod_id').value = it.id;
        qs('#prod_sku').value = it.sku || '';
        qs('#prod_name').value = it.name || '';
        qs('#prod_category').value = it.category || '';
        qs('#prod_quantity').value = it.quantity || 0;
        qs('#prod_unitCost').value = it.unitCost || 0;
        qs('#prod_unitPrice').value = it.unitPrice || 0;
    } catch(e){ alert('Failed to load product details.'); return; }
  }

  qs('#saveProductBtn')?.addEventListener('click', async ()=>{
    if(!window.confirm('Confirm: Save Changes?')) return;

    const idVal = qs('#prod_id').value;
    const body = {
      sku: qs('#prod_sku').value,
      name: qs('#prod_name').value,
      category: qs('#prod_category').value,
      quantity: Number(qs('#prod_quantity').value||0),
      unitCost: Number(qs('#prod_unitCost').value||0),
      unitPrice: Number(qs('#prod_unitPrice').value||0)
    };
    
    try{
        const res = await apiFetch(`${API_BASE}/inventory/${idVal}`, { method:'PUT', body: JSON.stringify(body) });
        if(res.ok) {
            alert('✅ Item updated');
            window.location.href = 'inventory.html';
        } else {
            alert('❌ Failed to update item.');
        }
    } catch(e) { console.error(e); alert('❌ Server connection error during update.'); }
  });

  qs('#cancelProductBtn')?.addEventListener('click', ()=> window.location.href = 'inventory.html');
}

// ====== DOCUMENTS LOGIC (Confirmation logic) ======

// Function to handle simulated file upload
async function uploadDocuments() {
    const files = qs('#docUpload').files;
    const msgEl = qs('.controls p#uploadMessage') || document.createElement('p');
    msgEl.id = 'uploadMessage';
    msgEl.style.marginTop = '10px';
    qs('.controls').appendChild(msgEl);

    if (files.length === 0) {
        showMsg(msgEl, '⚠️ Please select files to upload.', 'red');
        return;
    }
    
    // Confirmation Dialog
    if(!window.confirm(`Confirm Upload: Upload metadata for ${files.length} document(s)?`)) {
        showMsg(msgEl, 'Upload cancelled.', 'orange');
        return;
    }

    showMsg(msgEl, `Uploading ${files.length} document(s) metadata...`, 'orange');

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const docMetadata = {
            name: file.name,
            type: file.type,
            sizeBytes: file.size,
        };

        try {
            const res = await apiFetch(`${API_BASE}/documents`, { 
                method: 'POST', 
                body: JSON.stringify(docMetadata) 
            });

            if(!res.ok) throw new Error('Server responded with an error.');

            showMsg(msgEl, `✅ Uploaded metadata for ${file.name}.`, 'green');
            
        } catch (e) {
            console.error(`Error uploading metadata for ${file.name}:`, e);
            showMsg(msgEl, `❌ Failed to upload metadata for ${file.name}.`, 'red');
            return; 
        }
    }

    qs('#docUpload').value = '';
    setTimeout(async () => {
        await fetchDocuments();
        msgEl.remove();
    }, 1000);
}

// Function to handle document download (simulated via server redirect)
function downloadDocument(fileName) {
    if(!window.confirm(`Confirm Download: ${fileName}?`)) return;
    window.open(`${API_BASE}/documents/download/${encodeURIComponent(fileName)}`, '_blank');
}

async function deleteDocumentConfirm(id) {
    const doc = documents.find(d => String(d.id) === String(id));
    if(!doc) return;

    if(confirm(`Are you sure you want to delete document metadata for: ${doc.name}?`)) {
        await deleteDocument(id);
    }
}

async function deleteDocument(id) {
    try {
        const res = await apiFetch(`${API_BASE}/documents/${id}`, { method: 'DELETE' });
        if(res.status === 204){
            await fetchDocuments(); 
            alert('🗑️ Document metadata deleted successfully!');
        } else {
            alert('❌ Failed to delete document metadata.');
        }
    } catch(e) { console.error('Error deleting document:', e); alert('❌ Server error while deleting document metadata.'); }
}

function searchDocuments() {
    const query = qs('#searchDocs')?.value.toLowerCase().trim();
    const filtered = documents.filter(doc => 
        doc.name.toLowerCase().includes(query) || 
        new Date(doc.date).toLocaleString().toLowerCase().includes(query)
    );
    renderDocuments(filtered);
}

function bindDocumentsUI() {
    qs('#uploadDocsBtn')?.addEventListener('click', uploadDocuments);
    qs('#searchDocs')?.addEventListener('input', searchDocuments);
}

// ====== NEW: Bindings for Setting page ======
async function bindSettingPage(){
    const currentUsername = getUsername();
    if(qs('#currentUser')) qs('#currentUser').textContent = currentUsername;

    qs('#changePasswordBtn')?.addEventListener('click', async () => {
        const newPass = qs('#newPassword')?.value;
        const confPass = qs('#confirmPassword')?.value;
        const code = qs('#securityCode')?.value;
        const msgEl = qs('#passwordMessage');
        showMsg(msgEl, '');

        if (!newPass || !confPass || !code) {
            return showMsg(msgEl, '⚠️ Please fill in all fields.', 'red');
        }
        if (newPass !== confPass) {
            return showMsg(msgEl, '⚠️ New password and confirmation do not match.', 'red');
        }

        if (!window.confirm('Confirm Password Change? You will be logged out after a successful update.')) return;


        try {
            const res = await apiFetch(`${API_BASE}/account/password`, { 
                method: 'PUT', 
                body: JSON.stringify({ 
                    username: currentUsername,
                    newPassword: newPass, 
                    securityCode: code 
                }) 
            });
            const data = await res.json();

            if (res.ok) {
                showMsg(msgEl, '✅ Password updated successfully! Please log in again.', 'green');
                qs('#newPassword').value = '';
                qs('#confirmPassword').value = '';
                qs('#securityCode').value = '';
                setTimeout(logout, 1500); 
            } else {
                showMsg(msgEl, `❌ ${data.message || 'Failed to change password.'}`, 'red');
            }
        } catch (e) {
            showMsg(msgEl, '❌ Server connection failed during password change.', 'red');
        }
    });

    qs('#deleteAccountBtn')?.addEventListener('click', async () => {
        if (!window.confirm(`⚠️ WARNING: Are you absolutely sure you want to delete the account for "${currentUsername}"? This action cannot be undone.`)) return;
        
        const code = prompt('Enter Admin Security Code to CONFIRM account deletion:');
        if (!code) return alert('Deletion cancelled.');

        try {
            const res = await apiFetch(`${API_BASE}/account`, { 
                method: 'DELETE', 
                body: JSON.stringify({ 
                    username: currentUsername,
                    securityCode: code 
                }) 
            });
            const data = await res.json();

            if (res.ok) {
                alert('🗑️ Account deleted successfully. You will now be logged out.');
                logout();
            } else {
                alert(`❌ ${data.message || 'Failed to delete account.'}`);
            }
        } catch (e) {
            alert('❌ Server connection failed during account deletion.');
        }
    });
}
