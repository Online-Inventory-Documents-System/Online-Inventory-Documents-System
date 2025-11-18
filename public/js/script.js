// ==============================
// Online Inventory & Document System - script.js
// ==============================

// ------------------------------
// CONFIG
// ------------------------------
const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

// ------------------------------
// HELPER FUNCTIONS
// ------------------------------
const apiFetch = async (endpoint, options = {}) => {
  options.headers = {
    'Content-Type': 'application/json',
    'X-Username': getUsername(),
    ...options.headers
  };
  if (options.body && typeof options.body !== 'string') {
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(endpoint, options);
  return res.json();
};

const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';
const isLoggedIn = () => sessionStorage.getItem('isLoggedIn') === 'true';
const logout = () => {
  sessionStorage.clear();
  window.location.href = 'login.html';
};

// ------------------------------
// LOGIN
// ------------------------------
const loginForm = document.querySelector('#loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.querySelector('#username').value.trim();
    const pass = document.querySelector('#password').value.trim();
    const msgEl = document.querySelector('#loginMsg');

    if (!user || !pass) {
      msgEl.textContent = "Username and password are required.";
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        sessionStorage.setItem('isLoggedIn', 'true');
        sessionStorage.setItem('adminName', data.user);
        window.location.href = 'index.html';
      } else {
        msgEl.textContent = data.message || "Login failed";
      }

    } catch (err) {
      console.error("Login error:", err);
      msgEl.textContent = "Server error during login.";
    }
  });
}

// ------------------------------
// REGISTER
// ------------------------------
const registerForm = document.querySelector('#registerForm');
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.querySelector('#regUsername').value.trim();
    const pass = document.querySelector('#regPassword').value.trim();
    const secCode = document.querySelector('#regSecurityCode').value.trim();
    const msgEl = document.querySelector('#registerMsg');

    if (!user || !pass || !secCode) {
      msgEl.textContent = "All fields are required.";
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass, securityCode: secCode })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        msgEl.style.color = "green";
        msgEl.textContent = "Registration successful. Redirecting to login...";
        setTimeout(() => { window.location.href = 'login.html'; }, 1500);
      } else {
        msgEl.textContent = data.message || "Registration failed";
      }

    } catch (err) {
      console.error("Register error:", err);
      msgEl.textContent = "Server error during registration.";
    }
  });
}

// ------------------------------
// AUTO-REDIRECT IF NOT LOGGED IN
// ------------------------------
if (!isLoggedIn() && !window.location.pathname.includes('login.html') && !window.location.pathname.includes('register.html')) {
  window.location.href = 'login.html';
}

// ------------------------------
// PDF/XLSX GENERATION & DOWNLOAD
// ------------------------------
// Example function for generating inventory PDF/XLSX
async function downloadInventoryReport(type = 'pdf') {
  const endpoint = type === 'pdf' ? '/inventory/report/pdf' : '/inventory/report';
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'X-Username': getUsername() }
    });
    if (!res.ok) throw new Error('Failed to fetch report');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = type === 'pdf' 
      ? `Inventory_Report_${new Date().toISOString().slice(0,10)}.pdf` 
      : `Inventory_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Download report error:", err);
    alert("Failed to download report.");
  }
}

// ------------------------------
// DOCUMENT UPLOAD
// ------------------------------
async function uploadDocument(file) {
  if (!file) return;

  try {
    const res = await fetch(`${API_BASE}/documents`, {
      method: 'POST',
      headers: {
        'X-Username': getUsername(),
        'X-File-Name': file.name,
        'Content-Type': file.type
      },
      body: await file.arrayBuffer()
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Upload failed');
    alert(`Document uploaded: ${file.name}`);
  } catch (err) {
    console.error("Document upload error:", err);
    alert("Failed to upload document.");
  }
}

// ------------------------------
// DOCUMENT DOWNLOAD
// ------------------------------
async function downloadDocument(docId, fileName) {
  try {
    const res = await fetch(`${API_BASE}/documents/download/${docId}`, {
      headers: { 'X-Username': getUsername() }
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'document';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Document download error:", err);
    alert("Failed to download document.");
  }
}

// ------------------------------
// LOGOUT BUTTON HANDLER
// ------------------------------
const logoutBtn = document.querySelector('#logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => logout());
}
