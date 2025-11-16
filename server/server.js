// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents System

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');   // ✅ Required for PDF Reports

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || '1234';

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== Mongoose / Models =====
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Set MONGODB_URI environment variable.');
  process.exit(1);
}

mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('Connected to MongoDB Atlas'))
  .catch(err => { console.error('MongoDB connect error:', err); process.exit(1); });

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

// ===== safer logActivity =====
const DUPLICATE_WINDOW_MS = 30 * 1000;

async function logActivity(user, action){
  try {
    const safeUser = (user || 'Unknown').toString();
    const safeAction = (action || '').toString();
    const now = Date.now();

    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean().exec();
    if (last) {
      const lastUser = last.user || 'Unknown';
      const lastAction = last.action || '';
      const lastTime = last.time ? new Date(last.time).getTime() : 0;
      if (lastUser === safeUser && lastAction === safeAction && (now - lastTime) <= DUPLICATE_WINDOW_MS) {
        return; // avoid duplicates
      }
    }
    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error('logActivity error:', err);
  }
}

// ===== Health Check =====
app.get('/api/test', (req, res) =>
  res.json({ success:true, message:'API is up', time: new Date().toISOString() })
);

// ============================================================================
//                               AUTH SYSTEM
// ============================================================================
app.post('/api/register', async (req, res) => {
  const { username, password, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ success:false, message:'Invalid security code' });
  if (!username || !password)
    return res.status(400).json({ success:false, message:'Missing username or password' });

  try {
    const exists = await User.findOne({ username }).lean();
    if (exists)
      return res.status(409).json({ success:false, message:'Username already exists' });

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
  if (!username || !password)
    return res.status(400).json({ success:false, message:'Missing credentials' });

  try {
    const user = await User.findOne({ username, password }).lean();
    if (!user)
      return res.status(401).json({ success:false, message:'Invalid credentials' });

    await logActivity(username, 'Logged in');
    return res.json({ success:true, user: username });
  } catch(err){
    console.error('login error', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

app.put('/api/account/password', async (req, res) => {
  const { username, newPassword, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ message: 'Invalid Admin Security Code' });

  try {
    const user = await User.findOne({ username });
    if (!user)
      return res.status(404).json({ message:'User not found' });

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
  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ message:'Invalid Admin Security Code' });

  try {
    const result = await User.deleteOne({ username });
    if (result.deletedCount === 0)
      return res.status(404).json({ message:'User not found' });

    await logActivity('System', `Deleted account for user: ${username}`);
    return res.json({ success:true, message:'Account deleted successfully' });
  } catch (err) {
    console.error('delete account error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

// ============================================================================
//                                 INVENTORY CRUD
// ============================================================================
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const normalized = items.map(i => ({ ...i, id: i._id.toString() }));
    return res.json(normalized);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'], `Added product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new:true });
    if (!item)
      return res.status(404).json({ message:'Item not found' });

    await logActivity(req.headers['x-username'], `Updated product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
    return res.json(normalized);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndDelete(req.params.id);
    if (!item)
      return res.status(404).json({ message:'Item not found' });

    await logActivity(req.headers['x-username'], `Deleted product: ${item.name}`);
    return res.status(204).send();
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

// ============================================================================
//                  PDF REPORT — A4 LANDSCAPE — SINGLE PAGE (Medium Density)
// ============================================================================

app.get('/api/inventory/report/pdf', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();
    const filename = `Inventory_Report_${now.toISOString().slice(0,10)}.pdf`;

    // A4 landscape single page, no buffering (single page only)
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 36 // slightly tighter margins for more space
    });

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");

    doc.pipe(res);

    // helpers
    const pad = (n) => n.toString().padStart(2, '0');
    function formatDateTime(d) {
      // format DD/MM/YYYY HH:MM
      const day = pad(d.getDate());
      const month = pad(d.getMonth() + 1);
      const year = d.getFullYear();
      const hours = pad(d.getHours());
      const mins = pad(d.getMinutes());
      return `${day}/${month}/${year} ${hours}:${mins}`;
    }

    // Page metrics
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = doc.page.margins.left; // 36
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;

    // HEADER (exactly as requested)
    const headerLeftX = margin;
    const headerRightX = pageWidth - margin - 260; // meta block width ~260
    const headerTopY = margin;

    doc.font('Helvetica-Bold').fontSize(18).text('L&B Company', headerLeftX, headerTopY);
    doc.font('Helvetica').fontSize(10).text('Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', headerLeftX, headerTopY + 22);
    doc.text('Phone: 01133127622', headerLeftX, headerTopY + 36);
    doc.text('Email: lbcompany@gmail.com', headerLeftX, headerTopY + 50);

    doc.font('Helvetica-Bold').fontSize(16).text('INVENTORY REPORT', headerRightX, headerTopY);
    doc.font('Helvetica').fontSize(10).text(`Report #: REP-${Date.now()}`, headerRightX, headerTopY + 22);
    doc.text(`Date: ${formatDateTime(now)}`, headerRightX, headerTopY + 36);
    doc.text('Status: Generated', headerRightX, headerTopY + 50);

    // Move cursor down after header area
    const headerBottomY = headerTopY + 74;
    let cursorY = headerBottomY + 6;

    // Columns definition (initial guesses)
    let columns = [
      { key: 'sku', label: 'SKU', width: 110 },
      { key: 'name', label: 'Name', width: 300 },
      { key: 'category', label: 'Category', width: 180 },
      { key: 'quantity', label: 'Quantity', width: 60, align: 'right' },
      { key: 'unitCost', label: 'Unit Cost', width: 80, align: 'right' },
      { key: 'unitPrice', label: 'Unit Price', width: 80, align: 'right' },
      { key: 'invValue', label: 'Total Inventory Value', width: 110, align: 'right' },
      { key: 'revenue', label: 'Total Potential Revenue', width: 120, align: 'right' }
    ];

    // Ensure total columns width fits usableWidth. If not, scale down proportionally.
    const totalColsWidth = columns.reduce((s,c) => s + c.width, 0);
    if (totalColsWidth > usableWidth) {
      const scale = usableWidth / totalColsWidth;
      let accX = margin;
      columns = columns.map(c => {
        const w = Math.floor(c.width * scale);
        const col = { ...c, width: w, x: accX };
        accX += w;
        return col;
      });
    } else {
      // compute x positions
      let accX = margin;
      columns = columns.map(c => ({ ...c, x: accX, width: c.width }));
      accX += c => c.width;
    }

    // Table header
    doc.font('Helvetica-Bold').fontSize(10);
    columns.forEach(c => {
      doc.text(c.label, c.x, cursorY, { width: c.width, align: c.align || 'left' });
    });

    cursorY += 16;
    // horizontal rule
    doc.moveTo(margin, cursorY).lineTo(pageWidth - margin, cursorY).stroke();

    // Prepare rows
    const headerHeightSpace = cursorY; // y where rows start
    // initial font size and row height for medium density
    let fontSize = 10;
    let rowHeight = 14;

    // compute how many rows fit at current font/rowHeight
    const footerSpace = 70; // space reserved for totals + footer
    const availableRowsArea = pageHeight - cursorY - footerSpace - margin;
    let maxRows = Math.floor(availableRowsArea / rowHeight);

    // If too many rows, scale font/row height proportionally but keep readable
    if (items.length > maxRows) {
      const scale = maxRows / items.length;
      // scale font between min 6 and original
      const minFont = 7;
      fontSize = Math.max(minFont, Math.floor(fontSize * Math.max(scale, 0.5)));
      // adjust rowHeight accordingly
      rowHeight = Math.max(10, Math.floor(rowHeight * (fontSize / 10)));
      maxRows = Math.floor(availableRowsArea / rowHeight);
      // If still not enough (extreme case), we will allow tighter rows by reducing rowHeight further until fits or min row height reached
      let attempts = 0;
      while (items.length > maxRows && attempts < 5) {
        rowHeight = Math.max(9, Math.floor(rowHeight * 0.9));
        maxRows = Math.floor(availableRowsArea / rowHeight);
        attempts++;
      }
    }

    // draw rows (single page, no page breaks)
    doc.font('Helvetica').fontSize(fontSize);
    let totalInvValue = 0;
    let totalRevenue = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const invVal = qty * uc;
      const revenue = qty * up;
      totalInvValue += invVal;
      totalRevenue += revenue;

      // zebra
      if (i % 2 === 1) {
        doc.save();
        doc.rect(margin, cursorY - 2, usableWidth, rowHeight).fillOpacity(0.12).fill('#ededed');
        doc.restore();
      }

      // Write each cell with ellipsis to prevent overflow to next cell
      columns.forEach(c => {
        let text = '';
        if (c.key === 'sku') text = it.sku || '';
        else if (c.key === 'name') text = it.name || '';
        else if (c.key === 'category') text = it.category || '';
        else if (c.key === 'quantity') text = String(qty);
        else if (c.key === 'unitCost') text = `RM ${uc.toFixed(2)}`;
        else if (c.key === 'unitPrice') text = `RM ${up.toFixed(2)}`;
        else if (c.key === 'invValue') text = `RM ${invVal.toFixed(2)}`;
        else if (c.key === 'revenue') text = `RM ${revenue.toFixed(2)}`;

        // If text too long, use options to truncate (ellipsis)
        doc.text(text, c.x, cursorY, { width: c.width, align: c.align || 'left', ellipsis: true });
      });

      cursorY += rowHeight;
      // safety: if cursorY exceeds page height (shouldn't happen due to scaling) break
      if (cursorY + rowHeight + footerSpace >= pageHeight - margin) {
        // we've reached bottom — stop drawing further rows (they won't fit on single page)
        // Option: we could keep drawing smaller, but we've already attempted scaling above.
        break;
      }
    }

    // Totals area (right aligned)
    const totalsY = pageHeight - margin - 50;
    doc.font('Helvetica-Bold').fontSize(Math.max(10, fontSize));
    const totalsRightX = pageWidth - margin;
    doc.text(`TOTAL INVENTORY VALUE: RM ${totalInvValue.toFixed(2)}`, margin, totalsY, { align: 'right', width: usableWidth });
    doc.text(`TOTAL POTENTIAL REVENUE: RM ${totalRevenue.toFixed(2)}`, margin, totalsY + 16, { align: 'right', width: usableWidth });

    // Footer center
    doc.font('Helvetica').fontSize(9);
    doc.text('Thank you for your business.', margin, pageHeight - margin - 20, { align: 'center', width: usableWidth });
    doc.text('Generated by L&B Inventory System', margin, pageHeight - margin - 8, { align: 'center', width: usableWidth });

    // Close PDF
    doc.end();

  } catch (err) {
    console.error('PDF generate error', err);
    return res.status(500).json({ message:"PDF generation failed" });
  }
});

// ============================================================================
//                               XLSX REPORT (UNCHANGED)
// ============================================================================
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const filenameBase = `Inventory_Report_${new Date().toISOString().slice(0,10)}`

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

      ws_data.push([
        it.sku || "",
        it.name || "",
        it.category || "",
        qty,
        uc.toFixed(2),
        up.toFixed(2),
        invVal.toFixed(2),
        rev.toFixed(2)
      ]);
    });

    ws_data.push([]);
    ws_data.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");
    const wb_out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });

    await Doc.create({ name: filename, size: wb_out.length, date:new Date() });
    await logActivity(req.headers['x-username'], `Generated and saved Inventory Report: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);

  } catch(err){
    console.error('report error', err);
    return res.status(500).json({ message:'Report generation failed' });
  }
});

// ============================================================================
//                               DOCUMENTS CRUD
// ============================================================================
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date:-1 }).lean();
    const normalized = docs.map(d => ({ ...d, id: d._id.toString() }));
    return res.json(normalized);
  } catch (err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.post('/api/documents', async (req, res) => {
  try {
    const doc = await Doc.create({ ...req.body, date:new Date() });
    await logActivity(req.headers['x-username'], `Uploaded document metadata: ${doc.name}`);
    const normalized = { ...doc.toObject(), id: doc._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const doc = await Doc.findByIdAndDelete(req.params.id);
    if (!doc)
      return res.status(404).json({ message:'Document not found' });

    await logActivity(req.headers['x-username'], `Deleted document metadata: ${doc.name}`);
    return res.status(204).send();
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.get('/api/documents/download/:filename', async (req, res) => {
  const filename = req.params.filename || '';
  if (filename.startsWith('Inventory_Report')) {
    return res.redirect('/api/inventory/report');
  }
  return res.status(404).json({ message:"File not found or download unavailable on this mock server." });
});

// ============================================================================
//                                      LOGS
// ============================================================================
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time:-1 }).limit(500).lean();
    const formatted = logs.map(l => ({
      user: l.user,
      action: l.action,
      time: l.time ? new Date(l.time).toISOString() : new Date().toISOString()
    }));
    return res.json(formatted);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

// ============================================================================
//                              SERVE FRONTEND
// ============================================================================
app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/'))
    return res.status(404).json({ message:'API route not found' });

  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ============================================================================
//                           Start Helpers + Server
// ============================================================================
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username:'admin', password:'password' });
      await logActivity('System', 'Default admin user created.');
      console.log('Default admin user created.');
    }

    await logActivity('System', `Server is live on port ${PORT}`);
  } catch (err) {
    console.error('Startup helper error:', err);
  }
}

(async () => {
  await ensureDefaultAdminAndStartupLog();

  console.log(`Starting server...`);
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();
