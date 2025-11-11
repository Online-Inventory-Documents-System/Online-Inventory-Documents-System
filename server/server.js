// server/server.js

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Database / File Paths =====
const USERS_DB_PATH = path.join(__dirname, 'users.json');

// ===== Helper Functions =====
function loadUsersDB() {
    try {
        if (fs.existsSync(USERS_DB_PATH)) {
            const data = fs.readFileSync(USERS_DB_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error("Error reading users DB:", err);
    }
    return [{ username: 'admin', password: 'password' }];
}

function saveUsersDB() {
    try {
        fs.writeFileSync(USERS_DB_PATH, JSON.stringify(users, null, 2), 'utf8');
    } catch (err) {
        console.error("Error writing users DB:", err);
    }
}

// ===== In-Memory DB =====
let users = loadUsersDB();
let inventory = [];
let documents = [];
let activityLog = [{ user: 'System', action: 'Server started', time: new Date().toLocaleString() }];
const SECURITY_CODE = '1234';

// ===== Middleware =====
app.use(cors());
app.use(bodyParser.json());

// ===== Utility Functions =====
function logActivity(user, action) {
    const time = new Date().toLocaleString();
    activityLog.push({ user: user || 'Unknown', action, time });
    activityLog = activityLog.slice(-100);
}

// ===== API Routes =====

// Auth Routes
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        logActivity(username, 'Logged in');
        res.json({ success: true, user: username });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.post('/api/register', (req, res) => {
    const { username, password, securityCode } = req.body;
    if (securityCode !== SECURITY_CODE) return res.status(403).json({ success: false, message: 'Invalid security code' });
    if (users.some(u => u.username === username)) return res.status(409).json({ success: false, message: 'Username already exists' });

    users.push({ username, password });
    saveUsersDB();
    logActivity('System', `Registered new user: ${username}`);
    res.json({ success: true, message: 'Registration successful' });
});

app.put('/api/account/password', (req, res) => {
    const { username, newPassword, securityCode } = req.body;
    if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: 'Invalid Admin Security Code' });

    const userIndex = users.findIndex(u => u.username === username);
    if (userIndex === -1) return res.status(404).json({ message: 'User not found' });

    users[userIndex].password = newPassword;
    saveUsersDB();
    logActivity(username, 'Changed account password');
    res.json({ success: true, message: 'Password updated successfully' });
});

app.delete('/api/account', (req, res) => {
    const { username, securityCode } = req.body;
    if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: 'Invalid Admin Security Code' });

    const initialLength = users.length;
    users = users.filter(u => u.username !== username);
    if (users.length === initialLength) return res.status(404).json({ message: 'User not found' });

    saveUsersDB();
    logActivity('System', `Deleted account for user: ${username}`);
    res.json({ success: true, message: 'Account deleted successfully' });
});

// Inventory Routes
app.get('/api/inventory', (req, res) => res.json(inventory));

app.post('/api/inventory', (req, res) => {
    const item = { id: Date.now().toString(), ...req.body };
    inventory.push(item);
    logActivity(req.headers['x-username'], `Added product: ${item.name}`);
    res.status(201).json(item);
});

app.put('/api/inventory/:id', (req, res) => {
    const { id } = req.params;
    const index = inventory.findIndex(item => item.id === id);
    if (index === -1) return res.status(404).send('Item not found');

    inventory[index] = { ...inventory[index], id, ...req.body };
    logActivity(req.headers['x-username'], `Updated product: ${inventory[index].name}`);
    res.json(inventory[index]);
});

app.delete('/api/inventory/:id', (req, res) => {
    const { id } = req.params;
    const index = inventory.findIndex(item => item.id === id);
    if (index === -1) return res.status(404).send('Item not found');

    const [deletedItem] = inventory.splice(index, 1);
    logActivity(req.headers['x-username'], `Deleted product: ${deletedItem.name}`);
    res.status(204).send();
});

app.get('/api/inventory/report', (req, res) => {
    try {
        const ws_data = [
            ["L&B Company - Inventory Report"],
            ["Date:", new Date().toISOString()],
            [],
            ["SKU", "Name", "Category", "Quantity", "Unit Cost", "Unit Price", "Total Inventory Value", "Total Potential Revenue"]
        ];

        let totalValue = 0, totalRevenue = 0;

        inventory.forEach(it => {
            const qty = Number(it.quantity || 0);
            const uc = Number(it.unitCost || 0);
            const up = Number(it.unitPrice || 0);
            const invVal = qty * uc;
            const rev = qty * up;
            totalValue += invVal;
            totalRevenue += rev;
            ws_data.push([it.sku, it.name, it.category, qty, uc.toFixed(2), up.toFixed(2), invVal.toFixed(2), rev.toFixed(2)]);
        });

        ws_data.push([]);
        ws_data.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);

        const ws = xlsx.utils.aoa_to_sheet(ws_data);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");
        const wb_out = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
        const filename = `Inventory_Report_${new Date().toISOString().slice(0,10)}.xlsx`;

        documents.unshift({ id: Date.now().toString(), name: filename, size: wb_out.length, date: new Date().toISOString() });
        documents = documents.slice(0, 50);

        logActivity(req.headers['x-username'], `Generated Inventory Report: ${filename}`);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.send(wb_out);

    } catch (err) {
        console.error("Inventory report generation failed:", err);
        res.status(500).json({ message: "Report generation failed" });
    }
});

// Document Routes
app.get('/api/documents', (req, res) => res.json(documents));

app.post('/api/documents', (req, res) => {
    const doc = { id: Date.now().toString(), date: new Date().toISOString(), ...req.body };
    documents.unshift(doc);
    documents = documents.slice(0, 50);
    logActivity(req.headers['x-username'], `Uploaded document metadata: ${doc.name}`);
    res.status(201).json(doc);
});

app.get("/api/documents/download/:filename", (req, res) => {
    if (req.params.filename.startsWith("Inventory_Report")) {
        logActivity(req.headers['x-username'], `Re-downloaded Inventory Report`);
        return res.redirect('/api/inventory/report');
    }
    res.status(404).json({ message: "File not found or download unavailable on this mock server." });
});

// Activity Log
app.get('/api/logs', (req, res) => res.json(activityLog.slice().reverse()));

// ===== Serve Frontend (public folder) =====
app.use(express.static(path.join(__dirname, '../public')));

// Catch-all route for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ===== Start Server =====
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
