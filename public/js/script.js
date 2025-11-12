// public/js/script.js
const API_BASE = window.location.hostname.includes('localhost') ? 
  'http://localhost:3000/api' : 
  'https://online-inventory-documents-system-olzt.onrender.com/api';

function qs(sel){ return document.querySelector(sel); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }
function showMsg(el,text,color='red'){ if(!el) return; el.textContent=text; el.style.color=color; }
function escapeHtml(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }
const getUsername = ()=> sessionStorage.getItem('adminName')||'Guest';

let inventory=[], documents=[], activityLog=[];
const currentPage = window.location.pathname.split('/').pop();

async function apiFetch(url,options={}) {
  const user = getUsername();
  options.headers = { 'Content-Type':'application/json', 'X-Username':user, ...options.headers };
  try {
    const res = await fetch(url, options);
    let bodyText = await res.text();
    const parsed = (()=>{ try{return JSON.parse(bodyText);}catch(e){return bodyText;}})();
    if(!res.ok) { console.error('API ERROR',res.status,url,parsed); throw {status:res.status, body:parsed}; }
    return (typeof parsed==='string')?parsed:parsed;
  } catch(err){ console.error('apiFetch failed',err); throw err; }
}

// ===== AUTH =====
async function login(){
  const user=qs('#username')?.value.trim();
  const pass=qs('#password')?.value.trim();
  const msg=qs('#loginMessage');
  showMsg(msg,'');
  if(!user||!pass){ showMsg(msg,'⚠️ Enter username and password'); return; }
  try{
    const res = await apiFetch(`${API_BASE}/login`,{ method:'POST', body:JSON.stringify({username:user,password:pass}) });
    sessionStorage.setItem('isLoggedIn','true');
    sessionStorage.setItem('adminName',user);
    showMsg(msg,'✅ Login success','green');
    setTimeout(()=> window.location.href='index.html',700);
  }catch(e){ showMsg(msg, e.body?.message || '❌ Server error','red'); }
}

async function register(){
  const user=qs('#newUsername')?.value.trim();
  const pass=qs('#newPassword')?.value.trim();
  const code=qs('#securityCode')?.value.trim();
  const msg=qs('#registerMessage');
  showMsg(msg,'');
  if(!user||!pass||!code){ showMsg(msg,'⚠️ Fill all fields'); return; }
  try{
    const res=await apiFetch(`${API_BASE}/register`,{ method:'POST', body:JSON.stringify({username:user,password:pass,securityCode:code}) });
    showMsg(msg,'✅ Registered, login now','green');
    setTimeout(toggleForm,900);
  }catch(e){ showMsg(msg,e.body?.message || '❌ Server error','red'); }
}

function toggleForm(){
  const loginForm=qs('#loginForm'), registerForm=qs('#registerForm'), formTitle=qs('#formTitle');
  if(!loginForm||!registerForm||!formTitle) return;
  if(getComputedStyle(loginForm).display==='none'){
    loginForm.style.display='block';
    registerForm.style.display='none';
    formTitle.textContent='🔐 Admin Login';
  } else {
    loginForm.style.display='none';
    registerForm.style.display='block';
    formTitle.textContent='🧾 Register Account';
  }
}

function logout(){ sessionStorage.clear(); window.location.href='login.html'; }
function toggleTheme(){ document.body.classList.toggle('dark-mode'); }

// ===== INVENTORY =====
function renderInventory(items){
  const listEl=qs('#inventoryList'); if(!listEl) return;
  listEl.innerHTML=''; let totalValue=0,totalRevenue=0,totalStock=0;
  items.forEach(item=>{
    const qty=Number(item.quantity||0), uc=Number(item.unitCost||0), up=Number(item.unitPrice||0);
    totalValue+=qty*uc; totalRevenue+=qty*up; totalStock+=qty;
    const row=document.createElement('tr');
    row.dataset.id=item._id;
    if(qty===0) row.classList.add('out-of-stock-row');
    else if(qty<10) row.classList.add('low-stock-row');
    row.innerHTML=`
      <td>${escapeHtml(item.sku)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.category)}</td>
      <td>${qty}</td>
      <td>RM ${uc.toFixed(2)}</td>
      <td>RM ${up.toFixed(2)}</td>
      <td>RM ${(qty*uc).toFixed(2)}</td>
      <td>
        <button onclick="openEditPageForItem('${item._id}')">✏️ Edit</button>
        <button onclick="confirmAndDeleteItem('${item._id}')">🗑️ Delete</button>
      </td>`;
    listEl.appendChild(row);
  });
  if(qs('#totalValue')) qs('#totalValue').textContent=totalValue.toFixed(2);
  if(qs('#totalRevenue')) qs('#totalRevenue').textContent=totalRevenue.toFixed(2);
  if(qs('#totalStock')) qs('#totalStock').textContent=totalStock;
}

async function fetchInventory(){
  inventory = await apiFetch(`${API_BASE}/inventory`);
  renderInventory(inventory);
  renderDashboardData();
}

async function confirmAndAddProduct(){
  const sku=qs('#p_sku')?.value.trim(), name=qs('#p_name')?.value.trim();
  const category=qs('#p_category')?.value.trim();
  const quantity=parseInt(qs('#p_quantity')?.value||0,10);
  const unitCost=parseFloat(qs('#p_unitCost')?.value||0);
  const unitPrice=parseFloat(qs('#p_unitPrice')?.value||0);
  if(!sku||!name) return alert('Enter SKU and Name');
  if(!confirm(`Add Product: ${name}?`)) return;
  await apiFetch(`${API_BASE}/inventory`,{ method:'POST', body:JSON.stringify({sku,name,category,quantity,unitCost,unitPrice}) });
  await fetchInventory(); alert('✅ Product added');
}

async function confirmAndDeleteItem(id){
  const item=inventory.find(i=>i._id===id);
  if(!item) return; if(!confirm(`Delete ${item.name}?`)) return;
  await apiFetch(`${API_BASE}/inventory/${id}`,{ method:'DELETE' });
  await fetchInventory(); alert('🗑️ Item deleted');
}

// ===== DOCUMENTS =====
function renderDocuments(docs){
  const listEl=qs('#docList'); if(!listEl) return; listEl.innerHTML='';
  docs.forEach(doc=>{
    const row=document.createElement('tr');
    const sizeMB=(doc.sizeBytes/(1024*1024)).toFixed(2);
    row.innerHTML=`
      <td>${escapeHtml(doc.name)}</td>
      <td>${sizeMB} MB</td>
      <td>${new Date(doc.date).toLocaleString()}</td>
      <td>
        <button onclick="downloadDocument('${encodeURIComponent(doc.name)}')">⬇️ Download</button>
        <button onclick="deleteDocumentConfirm('${doc._id}')">🗑️ Delete</button>
      </td>`;
    listEl.appendChild(row);
  });
}

async function fetchDocuments(){ documents = await apiFetch(`${API_BASE}/documents`); renderDocuments(documents); }
function downloadDocument(name){ if(confirm(`Download ${decodeURIComponent(name)}?`)) window.open(`${API_BASE}/documents/download/${name}`); }
async function deleteDocumentConfirm(id){ if(confirm('Delete document?')) { await apiFetch(`${API_BASE}/documents/${id}`,{ method:'DELETE' }); await fetchDocuments(); alert('Deleted'); } }

// ===== DASHBOARD =====
async function fetchLogs(){ activityLog = await apiFetch(`${API_BASE}/logs`); renderLogs(); }
function renderLogs(){
  const listEl=qs('#logList'); if(!listEl) return; listEl.innerHTML='';
  activityLog.slice().reverse().forEach(log=>{
    const li=document.createElement('li');
    li.textContent=`[${new Date(log.time).toLocaleString()}] ${log.user}: ${log.action}`;
    listEl.appendChild(li);
  });
  renderDashboardData();
}
function renderDashboardData(){
  if(!qs('#dash_totalItems')) return;
  qs('#dash_totalItems').textContent=inventory.length;
  let totalValue=0,totalRevenue=0,totalStock=0;
  inventory.forEach(i=>{ totalValue+=i.quantity*i.unitCost; totalRevenue+=i.quantity*i.unitPrice; totalStock+=i.quantity; });
  qs('#dash_totalValue').textContent=totalValue.toFixed(2);
  qs('#dash_totalRevenue').textContent=totalRevenue.toFixed(2);
  qs('#dash_totalStock').textContent=totalStock;
  const recent=qs('#recentActivities');
  if(recent){ recent.innerHTML=''; activityLog.slice().reverse().slice(0,5).forEach(l=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${l.user}</td><td>${l.action}</td><td>${new Date(l.time).toLocaleString()}</td>`; recent.appendChild(tr); }); }
}

// ===== SETTINGS =====
async function changePassword(){
  const user=getUsername();
  const newPass=qs('#newPass')?.value.trim();
  const code=qs('#settingsCode')?.value.trim();
  if(!newPass||!code) return alert('Fill fields');
  await apiFetch(`${API_BASE}/account/password`,{ method:'PUT', body:JSON.stringify({username:user,newPassword:newPass,securityCode:code}) });
  alert('✅ Password changed');
}

async function deleteAccount(){
  const user=getUsername();
  const code=qs('#settingsCode')?.value.trim();
  if(!user||!code) return alert('Missing info');
  if(!confirm('Delete account? This cannot be undone')) return;
  await apiFetch(`${API_BASE}/account`,{ method:'DELETE', body:JSON.stringify({username:user,securityCode:code}) });
  alert('Account deleted'); logout();
}

// ===== INITIALIZE PAGE =====
document.addEventListener('DOMContentLoaded',()=>{
  if(currentPage==='index.html'){
    fetchInventory(); fetchDocuments(); fetchLogs();
  }
});
