// server/server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== File paths (files live in server/ directory) =====
const USERS_DB_PATH = path.join(__dirname, 'users.json');
const INVENTORY_DB_PATH = path.join(__dirname, 'inventory.json');
const DOCUMENTS_DB_PATH = path.join(__dirname, 'documents.json');
// optional persisted logs file
const LOGS_DB_PATH = path.join(__dirname, 'activity_log.json');

// ===== Server security / config =====
const SECURITY_CODE = '1234'; // must match client-side CONFIG.SECURITY_CODE if used

// ===== Helpers: safe read/write JSON =====
function safeReadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
  return fallback;
}

function safeWriteJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
    return false;
  }
}

// ===== Load DBs (persisted) or defaults =====
let users = safeReadJSON(USERS_DB_PATH, [{ username: 'admin', password: 'password' }]);
let inventory = safeReadJSON(INVENTORY_DB_PATH, []);
let documents = safeReadJSON(DOCUMENTS_DB_PATH, []);
let activityLog = safeReadJSON(LOGS_DB_PATH, [{ user: 'System', action: 'Server started', time: new Date().toLocaleString() }]);

// Keep logs capped
function pushLog(entry) {
  activityLog.push(entry);
  activityLog = activityLog.slice(-500);
  // Attempt to persist logs, but don't fail hard if it can't
  safeWriteJSON(LOGS_DB_PATH, activityLog);
}

// ===== Middleware =====
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== Utility =====
function logActivity(user, action) {
  const time = new Date().toLocaleString();
  const entry = { user: user || 'Unknown', action, time };
  pushLog(entry);
  console.log(`[LOG] ${entry.time} - ${entry.user}: ${entry.action}`);
}

// Simple health check
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'API is up', time: new Date().toISOString() });
});

// ===== Auth Routes =====

// POST /api/login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = users.find(u => u.username === username && u.password === password);
  if (user) {
    logActivity(username, 'Logged in');
    return res.json({ success: true, user: username });
  }
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// POST /api/register
app.post('/api/register', (req, res) => {
  const { username, password, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) {
    return res.status(403).json({ success: false, message: 'Invalid security code' });
  }
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Missing username or password' });
  }
  if (users.some(u => u.username === username)) {
    return res.status(409).json({ success: false, message: 'Username already exists' });
  }

  users.push({ username, password });
  safeWriteJSON(USERS_DB_PATH, users);
  logActivity('System', `Registered new user: ${username}`);
  return res.json({ success: true, message: 'Registration successful' });
});

// PUT /api/account/password
app.put('/api/account/password', (req, res) => {
  const { username, newPassword, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) {
    return res.status(403).json({ message: 'Invalid Admin Security Code' });
  }
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return res.status(404).json({ message: 'User not found' });

  users[idx].password = newPassword;
  safeWriteJSON(USERS_DB_PATH, users);
  logActivity(username, 'Changed account password');
  return res.json({ success: true, message: 'Password updated successfully' });
});

// DELETE /api/account
app.delete('/api/account', (req, res) => {
  const { username, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) {
    return res.status(403).json({ message: 'Invalid Admin Security Code' });
  }
  const initialLength = users.length;
  users = users.filter(u => u.username !== username);
  if (users.length === initialLength) return res.status(404).json({ message: 'User not found' });

  safeWriteJSON(USERS_DB_PATH, users);
  logActivity('System', `Deleted account for user: ${username}`);
  return res.json({ success: true, message: 'Account deleted successfully' });
});

// ===== Inventory Routes =====

// GET /api/inventory
app.get('/api/inventory', (req, res) => {
  return res.json(inventory);
});

// POST /api/inventory
app.post('/api/inventory', (req, res) => {
  const item = { id: Date.now().toString(), ...req.body };
  inventory.push(item);
  safeWriteJSON(INVENTORY_DB_PATH, inventory);
  logActivity(req.headers['x-username'], `Added product: ${item.name}`);
  return res.status(201).json(item);
});

// PUT /api/inventory/:id
app.put('/api/inventory/:id', (req, res) => {
  const { id } = req.params;
  const idx = inventory.findIndex(it => String(it.id) === String(id));
  if (idx === -1) return res.status(404).json({ message: 'Item not found' });

  inventory[idx] = { ...inventory[idx], id, ...req.body };
  safeWriteJSON(INVENTORY_DB_PATH, inventory);
  logActivity(req.headers['x-username'], `Updated product: ${inventory[idx].name}`);
  return res.json(inventory[idx]);
});

// DELETE /api/inventory/:id
app.delete('/api/inventory/:id', (req, res) => {
  const { id } = req.params;
  const idx = inventory.findIndex(it => String(it.id) === String(id));
  if (idx === -1) return res.status(404).json({ message: 'Item not found' });

  const [deleted] = inventory.splice(idx, 1);
  safeWriteJSON(INVENTORY_DB_PATH, inventory);
  logActivity(req.headers['x-username'], `Deleted product: ${deleted.name}`);
  return res.status(204).send();
});

// GET /api/inventory/report
app.get('/api/inventory/report', (req, res) => {
  try {
    const items = inventory;
    const filenameBase = `Inventory_Report_${new Date().toISOString().slice(0, 10)}`;
    const filename = `${filenameBase}.xlsx`;
    const dateNow = new Date().toISOString();

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", dateNow],
      [],
      ["SKU", "Name", "Category", "Quantity", "Unit Cost", "Unit Price", "Total Inventory Value", "Total Potential Revenue"]
    ];

    let totalValue = 0, totalRevenue = 0;

    items.forEach(it => {
      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const invVal = qty * uc;
      const rev = qty * up;
      totalValue += invVal;
      totalRevenue += rev;
      ws_data.push([it.sku || '', it.name || '', it.category || '', qty, uc.toFixed(2), up.toFixed(2), invVal.toFixed(2), rev.toFixed(2)]);
    });

    ws_data.push([]);
    ws_data.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");
    const wb_out = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    // add to documents list (persist)
    const doc = { id: Date.now().toString(), name: filename, size: wb_out.length, date: dateNow };
    documents.unshift(doc);
    documents = documents.slice(0, 50);
    safeWriteJSON(DOCUMENTS_DB_PATH, documents);

    logActivity(req.headers['x-username'], `Generated and saved Inventory Report: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);
  } catch (err) {
    console.error("report generation failed:", err);
    return res.status(500).json({ message: "Report generation failed" });
  }
});

// ===== Documents Routes =====

// GET /api/documents
app.get('/api/documents', (req, res) => {
  return res.json(documents);
});

// POST /api/documents (metadata upload simulation)
app.post('/api/documents', (req, res) => {
  const doc = { id: Date.now().toString(), date: new Date().toISOString(), ...req.body };
  documents.unshift(doc);
  documents = documents.slice(0, 50);
  safeWriteJSON(DOCUMENTS_DB_PATH, documents);
  logActivity(req.headers['x-username'], `Uploaded document metadata: ${doc.name}`);
  return res.status(201).json(doc);
});

// DELETE /api/documents/:id
app.delete('/api/documents/:id', (req, res) => {
  const { id } = req.params;
  const idx = documents.findIndex(d => String(d.id) === String(id));
  if (idx === -1) return res.status(404).json({ message: 'Document not found' });

  const [deleted] = documents.splice(idx, 1);
  safeWriteJSON(DOCUMENTS_DB_PATH, documents);
  logActivity(req.headers['x-username'], `Deleted document metadata: ${deleted.name || deleted.id}`);
  return res.status(204).send();
});

// GET /api/documents/download/:filename
app.get('/api/documents/download/:filename', (req, res) => {
  const filename = req.params.filename || '';
  if (filename.startsWith('Inventory_Report')) {
    logActivity(req.headers['x-username'], `Re-downloaded Inventory Report: ${filename}`);
    // Re-generate and stream the report (redirect to inventory report endpoint)
    return res.redirect('/api/inventory/report');
  }
  // No real file storage for arbitrary uploads in this simple mock server
  return res.status(404).json({ message: "File not found or download unavailable on this mock server." });
});

// ===== Activity Log Routes =====
app.get('/api/logs', (req, res) => {
  // Return reversed so newest first (front-end expects the reverse in some places)
  return res.json(activityLog.slice().reverse());
});

// ===== Serve Frontend (public folder) =====
// Serve API first, then static files:
app.use(express.static(path.join(__dirname, '../public')));

// Catch-all: for client-side routing, serve index.html (but avoid intercepting API paths)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'API route not found' });
  }
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  logActivity('System', `Server started on port ${PORT}`);
});
