// server/server.js
// FINAL: Auto-install dependencies on startup + Full backend + Invoice-style PDF (A4 landscape, full-grid)

// -------------------- Auto-installer (no CMD required) --------------------
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function ensureDependencies(pkgs = []) {
  const missing = [];
  for (const p of pkgs) {
    try {
      require.resolve(p);
    } catch (e) {
      missing.push(p);
    }
  }
  if (missing.length === 0) return;
  console.log('Missing packages detected:', missing.join(', '));
  try {
    // Use npm to install missing packages synchronously
    const cmd = `npm install --no-audit --no-fund ${missing.join(' ')}`;
    console.log('Installing missing packages:', cmd);
    execSync(cmd, { stdio: 'inherit' });
    console.log('Dependency install completed.');
  } catch (err) {
    console.error('Auto-install failed. Please run "npm install" manually.', err);
    // Do not exit; attempt to continue — will likely error later if modules missing
  }
}

// List of packages your app requires
ensureDependencies([
  'express',
  'cors',
  'mongoose',
  'xlsx',
  'pdfkit'
  // Note: body-parser is not required explicitly since express.json() used
]);

// -------------------- Now require modules (after auto-install) --------------------
const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const pathModule = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || '1234';

// -------------------- Middleware --------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -------------------- MongoDB connect check --------------------
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is required. Set it and restart.');
  // don't exit forcibly here if you want to test locally without DB; still recommended to exit
  process.exit(1);
}

mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('✅ Connected to MongoDB'))
  .catch(err => { console.error('❌ MongoDB connect error:', err); process.exit(1); });

// -------------------- Mongoose Models --------------------
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const InventorySchema = new Schema({
  sku: String,
  name: String,
  category: String,
  quantity: { type: Number, default: 0 },
  unitCost: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Inventory = mongoose.model('Inventory', InventorySchema);

const DocumentSchema = new Schema({
  name: String,
  size: Number,
  date: { type: Date, default: Date.now }
});
const Doc = mongoose.model('Doc', DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', LogSchema);

// -------------------- logActivity (suppress near-duplicates) --------------------
const DUPLICATE_WINDOW_MS = 30 * 1000;
async function logActivity(user, action){
  try {
    const safeUser = (user || 'System') + '';
    const safeAction = (action || '') + '';
    const now = Date.now();
    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean();
    if (last) {
      const lastTime = last.time ? new Date(last.time).getTime() : 0;
      if (last.user === safeUser && last.action === safeAction && (now - lastTime) <= DUPLICATE_WINDOW_MS) return;
    }
    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error('logActivity error:', err);
  }
}

// -------------------- Health check --------------------
app.get('/api/test', (req, res) => res.json({ success:true, message:'API is up', time: new Date().toISOString() }));

// -------------------- AUTH --------------------
app.post('/api/register', async (req, res) => {
  const { username, password, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ success:false, message:'Invalid security code' });
  if (!username || !password) return res.status(400).json({ success:false, message:'Missing username or password' });
  try {
    if (await User.findOne({ username })) return res.status(409).json({ success:false, message:'Username exists' });
    await User.create({ username, password });
    await logActivity('System', `Registered new user: ${username}`);
    return res.json({ success:true, message:'Registration successful' });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success:false, message:'Missing credentials' });
  try {
    const user = await User.findOne({ username, password }).lean();
    if (!user) return res.status(401).json({ success:false, message:'Invalid credentials' });
    await logActivity(username, 'Logged in');
    return res.json({ success:true, user: username });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

app.put('/api/account/password', async (req, res) => {
  const { username, newPassword, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ message:'Invalid Admin Security Code' });
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message:'User not found' });
    user.password = newPassword;
    await user.save();
    await logActivity(username, 'Changed account password');
    return res.json({ success:true, message:'Password updated successfully' });
  } catch (err) {
    console.error('change password error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.delete('/api/account', async (req, res) => {
  const { username, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ message:'Invalid Admin Security Code' });
  try {
    const result = await User.deleteOne({ username });
    if (result.deletedCount === 0) return res.status(404).json({ message:'User not found' });
    await logActivity('System', `Deleted account for user: ${username}`);
    return res.json({ success:true, message:'Account deleted successfully' });
  } catch (err) {
    console.error('delete account error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

// -------------------- Inventory CRUD --------------------
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    return res.json(items.map(i => ({ ...i, id: i._id.toString() })));
  } catch (err) {
    console.error('inventory fetch error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const it = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'] || 'Unknown', `Added product: ${it.name}`);
    return res.status(201).json({ ...it.toObject(), id: it._id.toString() });
  } catch (err) {
    console.error('inventory create error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const it = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new:true });
    if (!it) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Updated product: ${it.name}`);
    return res.json({ ...it.toObject(), id: it._id.toString() });
  } catch (err) {
    console.error('inventory update error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const it = await Inventory.findByIdAndDelete(req.params.id);
    if (!it) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Deleted product: ${it.name}`);
    return res.status(204).send();
  } catch (err) {
    console.error('inventory delete error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

// ============================================================================
//     FINAL — A4 LANDSCAPE INVENTORY PDF (Invoice Style, Clean Borders)
// ============================================================================
app.get('/api/inventory/report/pdf', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();

    const filename = `Inventory_Report_${now.toISOString().slice(0,10)}.pdf`;

    // A4 Landscape, margins, and page buffering for page numbers
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 40,
      bufferPages: true
    });

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // ==============================
    // HEADER (Invoice Style)
    // ==============================
    const headerY = 40;

    // Left Column
    doc.fontSize(22).font("Helvetica-Bold").text("L&B Company", 40, headerY);
    doc.fontSize(10).font("Helvetica")
      .text("Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka", 40, headerY + 28)
      .text("Phone: 01133127622", 40, headerY + 42)
      .text("Email: lbcompany@gmail.com", 40, headerY + 56);

    // Right Column
    doc.fontSize(18).font("Helvetica-Bold").text("INVENTORY REPORT", 520, headerY);
    doc.fontSize(10).font("Helvetica")
      .text(`Print Date: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`, 520, headerY + 26)
      .text(`Report ID: REP-${Date.now()}`, 520, headerY + 40)
      .text("Status: Generated", 520, headerY + 54);

    doc.moveDown(4);

    // ==============================
    // TABLE COLUMN POSITIONS (OPTIMIZED)
    // ==============================
    const col = {
      sku: 40,
      name: 120,
      category: 320,
      qty: 440,
      cost: 500,
      price: 580,
      value: 660,
      revenue: 780
    };

    const columnWidths = {
      sku: 80,
      name: 200,
      category: 120,
      qty: 60,
      cost: 80,
      price: 80,
      value: 120,
      revenue: 120
    };

    let startY = doc.y + 5;

    // ==============================
    // TABLE HEADER
    // ==============================
    doc.fontSize(11).font("Helvetica-Bold");

    doc.text("SKU", col.sku, startY, { width: columnWidths.sku });
    doc.text("Name", col.name, startY, { width: columnWidths.name });
    doc.text("Category", col.category, startY, { width: columnWidths.category });
    doc.text("Qty", col.qty, startY, { width: columnWidths.qty });
    doc.text("Unit Cost", col.cost, startY, { width: columnWidths.cost });
    doc.text("Unit Price", col.price, startY, { width: columnWidths.price });
    doc.text("Total Inventory Value", col.value, startY, { width: columnWidths.value });
    doc.text("Total Potential Revenue", col.revenue, startY, { width: columnWidths.revenue });

    let tableTop = startY + 18;

    // HEADER LINE
    doc.moveTo(40, tableTop).lineTo(900, tableTop).stroke();

    // ==============================
    // TABLE ROWS
    // ==============================
    doc.font("Helvetica").fontSize(10);

    let rowY = tableTop + 6;
    const rowHeight = 22;

    let totalQty = 0;
    let totalValue = 0;
    let totalRevenue = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];

      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const invVal = qty * uc;
      const rev = qty * up;

      totalQty += qty;
      totalValue += invVal;
      totalRevenue += rev;

      // Zebra striping
      if (i % 2 === 1) {
        doc.save();
        doc.fillOpacity(0.10).rect(40, rowY - 4, 860, rowHeight).fill("#cccccc");
        doc.restore();
      }

      // Draw row
      doc.text(it.sku || "", col.sku, rowY, { width: columnWidths.sku });
      doc.text(it.name || "", col.name, rowY, { width: columnWidths.name });
      doc.text(it.category || "", col.category, rowY, { width: columnWidths.category });
      doc.text(String(qty), col.qty, rowY);
      doc.text(`RM ${uc.toFixed(2)}`, col.cost, rowY);
      doc.text(`RM ${up.toFixed(2)}`, col.price, rowY);
      doc.text(`RM ${invVal.toFixed(2)}`, col.value, rowY);
      doc.text(`RM ${rev.toFixed(2)}`, col.revenue, rowY);

      // Next row
      rowY += rowHeight;

      // Prevent spilling off page (forced single-page mode)
      if (rowY > 420) break;
    }

    // ==============================
    // TABLE BORDER (FRAME)
    // ==============================
    const tableBottom = rowY + 5;

    doc.rect(40, tableTop, 860, tableBottom - tableTop).stroke();

    // ==============================
    // INVOICE TOTALS — BOTTOM RIGHT
    // ==============================
    const boxW = 260;
    const boxH = 80;
    const boxX = 900 - boxW;
    const boxY = tableBottom + 20;

    // Box outline
    doc.rect(boxX, boxY, boxW, boxH).stroke();

    doc.font("Helvetica-Bold").fontSize(11);
    doc.text(`Subtotal (Quantity): ${totalQty} units`, boxX + 10, boxY + 10);
    doc.text(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, boxX + 10, boxY + 30);
    doc.text(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, boxX + 10, boxY + 50);

    // ==============================
    // FOOTER
    // ==============================
    doc.fontSize(10).font("Helvetica").text("Generated by L&B Inventory System", 0, 560, {
      align: "center"
    });

    // Page Numbers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(9).text(`Page ${i + 1} of ${range.count}`, 0, doc.page.height - 30, {
        align: "center"
      });
    }

    doc.end();

  } catch (err) {
    console.error("PDF Error", err);
    res.status(500).json({ message: "PDF generation failed" });
  }
});

// -------------------- XLSX report --------------------
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const filenameBase = `Inventory_Report_${new Date().toISOString().slice(0,10)}`;
    const filename = `${filenameBase}.xlsx`;
    const dateOnly = new Date().toISOString().slice(0,10);

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", dateOnly],
      [],
      ["SKU","Name","Category","Quantity","Unit Cost","Unit Price","Total Inventory Value","Total Potential Revenue"]
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
      ws_data.push([it.sku||'', it.name||'', it.category||'', qty, uc.toFixed(2), up.toFixed(2), invVal.toFixed(2), rev.toFixed(2)]);
    });

    ws_data.push([]);
    ws_data.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Inventory Report');
    const wb_out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });

    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'] || 'System', `Generated XLSX: ${filename}`);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(wb_out);
  } catch (err) {
    console.error('XLSX error', err);
    return res.status(500).json({ message:'Report failed' });
  }
});

// -------------------- Documents --------------------
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date:-1 }).lean();
    res.json(docs.map(d => ({ ...d, id: d._id.toString() })));
  } catch (err) { console.error(err); res.status(500).json({ message:'Server error' }); }
});

app.post('/api/documents', async (req, res) => {
  try {
    const d = await Doc.create({ ...req.body, date: new Date() });
    await logActivity(req.headers['x-username'] || 'Unknown', `Uploaded doc: ${d.name}`);
    res.status(201).json({ ...d.toObject(), id: d._id.toString() });
  } catch (err) { console.error(err); res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const d = await Doc.findByIdAndDelete(req.params.id);
    if (!d) return res.status(404).json({ message:'Document not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Deleted doc: ${d.name}`);
    res.status(204).send();
  } catch (err) { console.error(err); res.status(500).json({ message:'Server error' }); }
});

app.get('/api/documents/download/:filename', (req, res) => {
  const filename = req.params.filename || '';
  if (filename.startsWith('Inventory_Report')) return res.redirect('/api/inventory/report');
  res.status(404).json({ message:'File not available' });
});

// -------------------- Logs --------------------
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time:-1 }).limit(500).lean();
    res.json(logs.map(l => ({ user: l.user, action: l.action, time: l.time ? new Date(l.time).toISOString() : new Date().toISOString() })));
  } catch (err) { console.error(err); res.status(500).json({ message:'Server error' }); }
});

// -------------------- Serve frontend --------------------
app.use(express.static(pathModule.join(__dirname, '../public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message:'API not found' });
  return res.sendFile(pathModule.join(__dirname, '../public/index.html'));
});

// -------------------- Startup --------------------
async function ensureDefaultAdmin() {
  try {
    const cnt = await User.countDocuments().exec();
    if (cnt === 0) {
      await User.create({ username:'admin', password:'password' });
      await logActivity('System', 'Default admin created');
      console.log('Default admin created');
    }
  } catch (err) { console.error('ensureDefaultAdmin error', err); }
}

(async () => {
  await ensureDefaultAdmin();
  await logActivity('System', `Server started on port ${PORT}`);
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
})();
