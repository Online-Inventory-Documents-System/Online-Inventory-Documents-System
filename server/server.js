// server/server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const xlsx = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000; 

// === Middleware ===
app.use(cors()); 
app.use(bodyParser.json());

// === In-Memory Database ===
let inventory = [];
let documents = [];
let activityLog = [{ user: 'System', action: 'Server started', time: new Date().toLocaleString() }];
let users = [{ username: 'admin', password: 'password' }];
const SECURITY_CODE = '1234';
const COMPANY_NAME = 'L&B Company';

// === Helper Functions ===
function getUsernameFromHeader(req) {
    return req.headers['x-username'] || 'Unknown';
}

function logActivity(user, action) {
    const time = new Date().toLocaleString();
    activityLog.push({ user: user || 'Unknown', action, time });
    activityLog = activityLog.slice(-100); 
}

// === API ROUTES ===

// --- Auth & Inventory Routes (Simplified for brevity, assumes standard implementation) ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        logActivity(username, `Logged in`);
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
    logActivity('System', `Registered new user: ${username}`);
    res.json({ success: true, message: 'Registration successful' });
});
app.get('/api/inventory', (req, res) => res.json(inventory));
app.post('/api/inventory', (req, res) => {
    const item = { id: Date.now().toString(), ...req.body };
    inventory.push(item);
    logActivity(getUsernameFromHeader(req), `Added product: ${item.name}`);
    res.status(201).json(item);
});
app.put('/api/inventory/:id', (req, res) => {
    const { id } = req.params;
    const index = inventory.findIndex(item => item.id === id);
    if (index === -1) return res.status(404).send('Item not found');
    inventory[index] = { ...inventory[index], ...req.body };
    logActivity(getUsernameFromHeader(req), `Updated product: ${inventory[index].name}`);
    res.json(inventory[index]);
});
app.delete('/api/inventory/:id', (req, res) => {
    const { id } = req.params;
    const index = inventory.findIndex(item => item.id === id);
    if (index === -1) return res.status(404).send('Item not found');
    const [deletedItem] = inventory.splice(index, 1);
    logActivity(getUsernameFromHeader(req), `Deleted product: ${deletedItem.name}`);
    res.status(204).send();
});

// --- Report Route (Excel Generation) ---
app.get('/api/report/excel', (req, res) => {
    const reportTime = new Date();
    const user = getUsernameFromHeader(req);
    const dateString = reportTime.toLocaleString();
    const timestamp = reportTime.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `${COMPANY_NAME}_Inventory_Report_${timestamp}.xlsx`;

    // 1. Prepare Worksheet Data with Header
    const ws_data = [
        [`${COMPANY_NAME} - Inventory Report`], // Company Name Header
        [`Generated On: ${dateString}`],        // Date and Time Header
        [],
        ['SKU', 'Name', 'Category', 'Quantity', 'Unit Cost', 'Unit Price', 'Total Value', 'Potential Revenue']
    ];
    
    inventory.forEach(item => {
        const qty = Number(item.quantity || 0);
        const uc = Number(item.unitCost || 0);
        const up = Number(item.unitPrice || 0);
        ws_data.push([
            item.sku, item.name, item.category, qty, 
            uc.toFixed(2), up.toFixed(2), 
            (qty * uc).toFixed(2), (qty * up).toFixed(2)
        ]);
    });

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    
    // Merge the title cells for cleanliness
    if(ws['!merges']) { 
        ws['!merges'].push(xlsx.utils.decode_range('A1:H1')); 
        ws['!merges'].push(xlsx.utils.decode_range('A2:H2')); 
    } else {
        ws['!merges'] = [xlsx.utils.decode_range('A1:H1'), xlsx.utils.decode_range('A2:H2')];
    }
    
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory_Report");

    // Generate Excel file buffer
    const wb_out = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    // 2. Log Activity and Add Document Entry
    logActivity(user, `Generated Inventory Report (Excel): ${filename}`);
    
    // Add the report metadata to the documents list
    documents.push({ 
        id: Date.now().toString(), 
        name: filename, 
        date: dateString,
        type: 'Report',
        // In a real system, you'd save the file content, but here we save metadata
        simulated: true 
    });

    // 3. Send the file for download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(wb_out);
});


// --- Document & Log Routes ---
app.get('/api/documents', (req, res) => res.json(documents));
app.post('/api/documents', (req, res) => {
    // This is for manual uploads - keeping it simple for the in-memory database
    const doc = { 
        id: Date.now().toString(), 
        name: req.body.name, 
        date: new Date().toLocaleDateString(),
        type: 'Manual'
    };
    documents.push(doc);
    logActivity(getUsernameFromHeader(req), `Uploaded document metadata: ${doc.name}`);
    res.status(201).json(doc);
});
app.get('/api/logs', (req, res) => res.json(activityLog.slice().reverse()));


// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});