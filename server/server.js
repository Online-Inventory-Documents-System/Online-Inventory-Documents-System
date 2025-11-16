const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const xlsx = require('xlsx');
const PDFDocument = require('pdfkit');
const pathModule = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || '1234';

// -------------------- middleware --------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -------------------- MongoDB connect guard --------------------
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is required. Set it and restart.');
  process.exit(1);
}

mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('✅ Connected to MongoDB'))
  .catch(err => { console.error('❌ MongoDB connect error:', err); process.exit(1); });

// -------------------- Models --------------------
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
    console.error('logActivity error', err);
  }
}

// -------------------- Health --------------------
app.get('/api/test', (req, res) => res.json({ success:true, time: new Date().toISOString() }));

// -------------------- Auth --------------------
app.post('/api/register', async (req, res) => {
  const { username, password, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ success:false, message:'Invalid security code' });
  if (!username || !password) return res.status(400).json({ success:false, message:'Missing fields' });
  try {
    if (await User.findOne({ username })) return res.status(409).json({ success:false, message:'Username exists' });
    await User.create({ username, password });
    await logActivity('System', `Registered new user: ${username}`);
    return res.json({ success:true, message:'Registration successful' });
  } catch (err) { console.error('register error', err); return res.status(500).json({ success:false, message:'Server error' }); }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success:false, message:'Missing credentials' });
  try {
    const user = await User.findOne({ username, password }).lean();
    if (!user) return res.status(401).json({ success:false, message:'Invalid credentials' });
    await logActivity(username, 'Logged in');
    return res.json({ success:true, user: username });
  } catch (err) { console.error('login error', err); return res.status(500).json({ success:false, message:'Server error' }); }
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
  } catch (err) { console.error('change password error', err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/account', async (req, res) => {
  const { username, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ message:'Invalid Admin Security Code' });
  try {
    const result = await User.deleteOne({ username });
    if (result.deletedCount === 0) return res.status(404).json({ message:'User not found' });
    await logActivity('System', `Deleted account for user: ${username}`);
    return res.json({ success:true, message:'Account deleted successfully' });
  } catch (err) { console.error('delete account error', err); return res.status(500).json({ message:'Server error' }); }
});

// -------------------- Inventory CRUD --------------------
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    return res.json(items.map(i => ({ ...i, id: i._id.toString() })));
  } catch (err) { console.error('inventory fetch error', err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const it = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'] || 'Unknown', `Added product: ${it.name}`);
    return res.status(201).json({ ...it.toObject(), id: it._id.toString() });
  } catch (err) { console.error('inventory create error', err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const it = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new:true });
    if (!it) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Updated product: ${it.name}`);
    return res.json({ ...it.toObject(), id: it._id.toString() });
  } catch (err) { console.error('inventory update error', err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const it = await Inventory.findByIdAndDelete(req.params.id);
    if (!it) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Deleted product: ${it.name}`);
    return res.status(204).send();
  } catch (err) { console.error('inventory delete error', err); return res.status(500).json({ message:'Server error' }); }
});

// -------------------- FINAL PDF: Full-grid A4 Landscape (Fixed widths, rowHeight=18) --------------------
app.get('/api/inventory/report/pdf', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();
    const filename = `Inventory_Report_${now.toISOString().slice(0,10)}.pdf`;

    // Create A4 landscape doc
    const doc = new PDFDocument({ size:'A4', layout:'landscape', margin:36, bufferPages: true });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    // Page metrics
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = doc.page.margins.left; // 36
    const usableW = pageW - margin*2;

    // Header (two-column)
    const headerY = margin;
    doc.font('Helvetica-Bold').fontSize(20).text('L&B Company', margin, headerY);
    doc.font('Helvetica').fontSize(9)
      .text('Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', margin, headerY + 26)
      .text('Phone: 01133127622', margin, headerY + 40)
      .text('Email: lbcompany@gmail.com', margin, headerY + 54);

    const rightX = pageW - margin - 320;
    doc.font('Helvetica-Bold').fontSize(16).text('INVENTORY REPORT', rightX, headerY);
    doc.font('Helvetica').fontSize(9)
      .text(`Print Date: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`, rightX, headerY + 24)
      .text(`Report ID: REP-${Date.now()}`, rightX, headerY + 38)
      .text('Status: Generated', rightX, headerY + 52);

    // Column widths (as confirmed)
    const colWidths = {
      sku: 60,
      name: 160,
      category: 80,
      qty: 60,
      unitCost: 80,
      unitPrice: 80,
      value: 110,
      revenue: 120
    };

    // Compute starting X for each column (left-aligned)
    const tableLeft = margin;
    const cols = [];
    let cx = tableLeft;
    const labels = {
      sku: 'SKU',
      name: 'Product Name',
      category: 'Category',
      qty: 'Quantity',
      unitCost: 'Unit Cost',
      unitPrice: 'Unit Price',
      value: 'Total Inventory Value',
      revenue: 'Total Potential Revenue'
    };
    for (const key of ['sku','name','category','qty','unitCost','unitPrice','value','revenue']) {
      cols.push({ key, x: cx, w: colWidths[key], label: labels[key] });
      cx += colWidths[key];
    }
    const tableWidth = cx - tableLeft;

    // Table placement
    const tableTop = headerY + 86; // some space after header
    // leave room for totals & footer: totals should be below table; keep bottom margin
    const bottomSpace = 110;
    const tableBottomLimit = pageH - margin - bottomSpace;
    let tableHeight = tableBottomLimit - tableTop;
    if (tableHeight < 80) tableHeight = 80;

    // Row layout
    const headerRowHeight = 20;
    const rowHeight = 18; // compact as requested
    const availableRows = Math.floor((tableHeight - headerRowHeight - 6) / rowHeight);

    // Styling & draw outer border
    doc.lineWidth(0.8).strokeColor('black');

    // Render header row labels
    doc.font('Helvetica-Bold').fontSize(9.5);
    const headerYPos = tableTop + 6;
    for (const c of cols) {
      doc.text(c.label, c.x + 4, headerYPos, { width: c.w - 8, align: 'left', ellipsis: true });
    }
    // draw top border and header bottom line
    const headerBottomY = tableTop + headerRowHeight;
    doc.moveTo(tableLeft, tableTop).lineTo(tableLeft + tableWidth, tableTop).stroke();
    doc.moveTo(tableLeft, headerBottomY).lineTo(tableLeft + tableWidth, headerBottomY).stroke();

    // Draw vertical separators for grid
    for (let i = 1; i < cols.length; i++) {
      const x = cols[i].x;
      doc.moveTo(x, tableTop).lineTo(x, tableTop + tableHeight).stroke();
    }

    // rows
    let y = headerBottomY + 4;
    doc.font('Helvetica').fontSize(9);
    let totalQty = 0;
    let totalValue = 0;
    let totalRevenue = 0;

    const renderCount = Math.min(items.length, availableRows);
    for (let i = 0; i < renderCount; i++) {
      const it = items[i];
      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const invVal = qty * uc;
      const rev = qty * up;

      totalQty += qty;
      totalValue += invVal;
      totalRevenue += rev;

      // zebra
      if (i % 2 === 1) {
        doc.save();
        doc.fillOpacity(0.10);
        doc.rect(tableLeft + 1, y - 3, tableWidth - 2, rowHeight).fill('#f2f2f2');
        doc.restore();
      }

      // text vertical centering offset
      const textY = y + Math.max(1, Math.floor((rowHeight - 9) / 2));

      // draw each cell
      for (const c of cols) {
        let text = '';
        if (c.key === 'sku') text = it.sku || '';
        if (c.key === 'name') text = it.name || '';
        if (c.key === 'category') text = it.category || '';
        if (c.key === 'qty') text = String(qty);
        if (c.key === 'unitCost') text = `RM ${uc.toFixed(2)}`;
        if (c.key === 'unitPrice') text = `RM ${up.toFixed(2)}`;
        if (c.key === 'value') text = `RM ${invVal.toFixed(2)}`;
        if (c.key === 'revenue') text = `RM ${rev.toFixed(2)}`;

        const alignRight = ['qty','unitCost','unitPrice','value','revenue'].includes(c.key);
        doc.text(text, c.x + 4, textY, { width: c.w - 8, align: alignRight ? 'right' : 'left', ellipsis: true });
      }

      // draw horizontal separator after row
      const lineY = y + rowHeight - 2;
      doc.moveTo(tableLeft, lineY).lineTo(tableLeft + tableWidth, lineY).stroke();

      y += rowHeight;
    }

    // draw outer frame for table (covering header+rows area)
    const drawnTableBottom = headerBottomY + 4 + (renderCount * rowHeight);
    doc.rect(tableLeft, tableTop, tableWidth, drawnTableBottom - tableTop).stroke();

    // omitted note if necessary (keeps single page)
    const omitted = items.length - renderCount;
    if (omitted > 0) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('red');
      doc.text(`Note: ${omitted} item(s) omitted to keep single-page layout.`, tableLeft + 4, drawnTableBottom + 8);
      doc.fillColor('black');
    }

    // Totals box (bottom-right) — placed below the table and above footer
    const totalsBoxW = 300;
    const totalsBoxH = 76;
    const totalsX = tableLeft + tableWidth - totalsBoxW; // right aligned with table
    // place totals box at or below drawnTableBottom + some padding but keep inside page
    let totalsY = drawnTableBottom + 16;
    // ensure totalsY + totalsBoxH + footer fits inside pageH - margin
    const footerReserve = 60;
    if (totalsY + totalsBoxH + footerReserve > pageH - margin) {
      totalsY = pageH - margin - footerReserve - totalsBoxH; // push up if necessary
    }

    // draw totals box
    doc.lineWidth(0.8).strokeColor('black');
    doc.rect(totalsX, totalsY, totalsBoxW, totalsBoxH).stroke();

    doc.font('Helvetica-Bold').fontSize(10);
    doc.text(`Subtotal (Quantity): ${totalQty} units`, totalsX + 10, totalsY + 10, { width: totalsBoxW - 20, align: 'right' });
    doc.text(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, totalsX + 10, totalsY + 28, { width: totalsBoxW - 20, align: 'right' });
    doc.text(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, totalsX + 10, totalsY + 46, { width: totalsBoxW - 20, align: 'right' });

    if (omitted > 0) {
      doc.font('Helvetica').fontSize(8).fillColor('red');
      doc.text(`* ${omitted} items not printed`, totalsX + 10, totalsY + 60, { width: totalsBoxW - 20, align: 'right' });
      doc.fillColor('black');
    }

    // Footer centered
    doc.font('Helvetica').fontSize(9).text('Thank you for your business.', margin, pageH - margin - 36, { align: 'center', width: usableW });
    doc.font('Helvetica').fontSize(9).text('Generated by L&B Inventory System', margin, pageH - margin - 22, { align: 'center', width: usableW });

    // Page numbers (single page but keep safe)
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).text(`Page ${i + 1} of ${range.count}`, 0, doc.page.height - 18, { align: 'center' });
    }

    doc.end();
  } catch (err) {
    console.error('PDF generation error', err);
    return res.status(500).json({ message:'PDF generation failed' });
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
      ["SKU","Product Name","Category","Quantity","Unit Cost","Unit Price","Total Inventory Value","Total Potential Revenue"]
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
  } catch (err) { console.error('XLSX error', err); return res.status(500).json({ message:'Report failed' }); }
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

// -------------------- Startup helpers --------------------
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

// -------------------- Start server --------------------
(async () => {
  await ensureDefaultAdmin();
  await logActivity('System', `Server started on port ${PORT}`);
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
})();
