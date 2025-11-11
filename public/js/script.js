const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

async function apiFetch(url, options={}) {
    const user = getUsername();
    options.headers = { 'Content-Type':'application/json', 'X-Username': user, ...options.headers };
    return fetch(url, options);
}

// ===== AUTH =====
async function login(){
    const user = document.querySelector('#username')?.value.trim();
    const pass = document.querySelector('#password')?.value.trim();
    const msg = document.querySelector('#loginMessage');
    msg.textContent = '';
    if(!user || !pass){ msg.textContent = 'Enter username and password'; return; }

    const res = await apiFetch(`${API_BASE}/login`, { method:'POST', body: JSON.stringify({ username:user, password:pass }) });
    const data = await res.json();
    if(res.ok){
        sessionStorage.setItem('isLoggedIn','true');
        sessionStorage.setItem('adminName', user);
        msg.textContent = 'Login successful';
        window.location.href = 'index.html';
    } else { msg.textContent = data.message || 'Login failed'; }
}

async function register(){
    const user = document.querySelector('#newUsername')?.value.trim();
    const pass = document.querySelector('#newPassword')?.value.trim();
    const code = document.querySelector('#securityCode')?.value.trim();
    const msg = document.querySelector('#registerMessage');
    msg.textContent = '';
    if(!user || !pass || !code){ msg.textContent='Fill all fields'; return; }

    const res = await apiFetch(`${API_BASE}/register`, { method:'POST', body: JSON.stringify({ username:user, password:pass, securityCode:code }) });
    const data = await res.json();
    if(res.ok) { alert('Registered! You can login now'); toggleForm(); }
    else { msg.textContent = data.message || 'Registration failed'; }
}

// ===== INVENTORY =====
async function addInventory(){
    const sku = document.querySelector('#p_sku')?.value;
    const name = document.querySelector('#p_name')?.value;
    const category = document.querySelector('#p_category')?.value;
    const qty = parseInt(document.querySelector('#p_quantity')?.value||0);
    const uc = parseFloat(document.querySelector('#p_unitCost')?.value||0);
    const up = parseFloat(document.querySelector('#p_unitPrice')?.value||0);

    const res = await apiFetch(`${API_BASE}/inventory`, { method:'POST', body: JSON.stringify({ sku,name,category,quantity:qty,unitCost:uc,unitPrice:up }) });
    const data = await res.json();
    if(res.ok){ alert('Item saved!'); fetchInventory(); }
    else { alert('Failed to save item'); }
}

async function updateInventory(id){
    const sku = document.querySelector('#prod_sku')?.value;
    const name = document.querySelector('#prod_name')?.value;
    const category = document.querySelector('#prod_category')?.value;
    const qty = parseInt(document.querySelector('#prod_quantity')?.value||0);
    const uc = parseFloat(document.querySelector('#prod_unitCost')?.value||0);
    const up = parseFloat(document.querySelector('#prod_unitPrice')?.value||0);

    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method:'PUT', body: JSON.stringify({ sku,name,category,quantity:qty,unitCost:uc,unitPrice:up }) });
    if(res.ok){ alert('Item updated'); window.location.href='inventory.html'; }
    else { alert('Failed to update'); }
}

async function deleteInventory(id){
    if(!confirm('Confirm delete?')) return;
    const res = await apiFetch(`${API_BASE}/inventory/${id}`, { method:'DELETE' });
    if(res.ok || res.status===204){ alert('Deleted'); fetchInventory(); }
    else { alert('Failed to delete'); }
}

// ===== DOCUMENTS =====
async function uploadDocuments(){
    const files = document.querySelector('#docUpload')?.files;
    if(!files || files.length===0) return alert('No files selected');

    for(const file of files){
        const metadata = { name:file.name, sizeBytes:file.size, type:file.type };
        const res = await apiFetch(`${API_BASE}/documents`, { method:'POST', body: JSON.stringify(metadata) });
        if(!res.ok){ alert(`Failed to upload ${file.name}`); return; }
    }
    alert('Files metadata uploaded'); fetchDocuments();
}

async function downloadDocument(filename){
    if(!confirm('Download file?')) return;
    window.open(`${API_BASE}/documents/download/${encodeURIComponent(filename)}`, '_blank');
}

async function deleteDocument(id){
    if(!confirm('Delete document?')) return;
    const res = await apiFetch(`${API_BASE}/documents/${id}`, { method:'DELETE' });
    if(res.ok || res.status===204){ alert('Deleted'); fetchDocuments(); }
    else { alert('Failed'); }
}

// ===== REPORT =====
async function generateReport(){
    if(!confirm('Generate Inventory Report?')) return;
    const res = await apiFetch(`${API_BASE}/inventory/report`);
    if(res.ok){
        const blob = await res.blob();
        const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || `Inventory_Report.xlsx`;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); window.URL.revokeObjectURL(url);
        fetchDocuments();
        alert('Report generated and saved in documents');
    } else { alert('Failed to generate report'); }
}
