// server/server.js
// Fully fixed: filesystem-backed uploads + metadata in MongoDB + streaming downloads
// Usage: PUT MONGODB_URI env var and run `node server.js`
// Requires: npm i express cors mongoose multer xlsx pdfkit

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const util = require('util');

const unlinkAsync = util.promisify(fs.unlink);

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "1234";

// ----- Basic middleware -----
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

// ----- Ensure uploads folder exists -----
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ----- Multer disk storage (save to uploads folder) -----
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    // sanitize original name and prefix with timestamp to avoid collisions
    const ts = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_() ]/g, '_');
    cb(null, `${ts}__${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB limit (adjust if needed)
});

// ----- MongoDB connection -----
if (!MONGODB_URI) {
  console.error("MONGODB_URI environment variable is not set. Exiting.");
  process.exit(1);
}
mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => { console.error('MongoDB connect error:', err); process.exit(1); });

const { Schema } = mongoose;

// ----- Schemas -----
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
  originalName: { type: String, required: true }, // original filename
  storedName: { type: String, required: true },   // filename in uploads folder
  path: { type: String, required: true },         // absolute or relative path
  size: { type: Number, default: 0 },
  contentType: { type: String, default: '' },
  date: { type: Date, default: Date.now }
});
const Doc = mongoose.model('Doc', DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', LogSchema);

// ----- Duplicate log protection -----
const DUPLICATE_WINDOW_MS = 30 * 1000;
async function logActivity(user, action) {
  try {
    const safeUser = (user || 'Unknown').toString();
    const safeAction = (action || '').toString();
    const now = Date.now();

    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean().exec();
    if (last) {
      const lastUser = last.user || 'Unknown';
      const lastAction = last.action || '';
      const lastTime = last.time ? new Date(last.time).getTime() : 0;
      if (lastUser === safeUser && lastAction === safeAction && now - lastTime <= DUPLICATE_WINDOW_MS) {
        return;
      }
    }

    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error('logActivity error:', err);
  }
}

// ----- Health check -----
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'API up', time: new Date().toISOString() });
});

// ========================= AUTH =========================
app.post('/api/register', async (req, res) => {
  const { username, password, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ success: false, message: 'Invalid security code' });
  if (!username || !password) return res.status(400).json({ success: false, message: 'Missing username or password' });

  try {
    const exists = await User.findOne({ username }).lean();
    if (exists) return res.status(409).json({ success: false, message: 'Username already exists' });
    await User.create({ username, password });
    await logActivity('System', `Registered user: ${username}`);
    res.json({ success: true, message: 'Registration successful' });
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, message: 'Missing credentials' });

  try {
    const user = await User.findOne({ username, password }).lean();
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    await logActivity(username, 'Logged in');
    res.json({ success: true, user: username });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ========================= INVENTORY CRUD =========================
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const normalized = items.map(i => ({ ...i, id: i._id.toString() }));
    res.json(normalized);
  } catch (err) {
    console.error('inventory get error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'], `Added: ${item.name}`);
    res.status(201).json({ ...item.toObject(), id: item._id.toString() });
  } catch (err) {
    console.error('inventory post error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    await logActivity(req.headers['x-username'], `Updated: ${item.name}`);
    res.json({ ...item.toObject(), id: item._id.toString() });
  } catch (err) {
    console.error('inventory update error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    await logActivity(req.headers['x-username'], `Deleted: ${item.name}`);
    res.status(204).send();
  } catch (err) {
    console.error('inventory delete error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ========================= PDF REPORT (stream & save file) =========================
app.get('/api/inventory/report/pdf', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();
    const printDate = new Date(now).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    const printedBy = req.headers['x-username'] || 'System';
    const filename = `Inventory_Report_${now.toISOString().slice(0, 10)}_${Date.now()}.pdf`;
    const storedName = `${Date.now()}__${filename.replace(/[^a-zA-Z0-9.\-_() ]/g,'_')}`;
    const outPath = path.join(UPLOADS_DIR, storedName);

    // Create PDF and write to both response stream and to a file
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true });
    // Pipe to response
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    const fileStream = fs.createWriteStream(outPath);
    doc.pipe(fileStream);
    doc.pipe(res);

    // Build PDF (similar to your previous implementation)
    doc.fontSize(22).font('Helvetica-Bold').text('L&B Company', 40, 40);
    doc.fontSize(10).font('Helvetica');
    doc.text('Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', 40, 70);
    doc.text('Phone: 01133127622', 40, 85);
    doc.text('Email: lbcompany@gmail.com', 40, 100);
    doc.font('Helvetica-Bold').fontSize(15).text('INVENTORY REPORT', 620, 40);
    doc.font('Helvetica').fontSize(10).text(`Print Date: ${printDate}`, 620, 63);
    doc.text(`Status: Generated`, 620, 93);
    doc.text(`Printed by: ${printedBy}`, 620, 108);
    doc.moveTo(40, 130).lineTo(800, 130).stroke();

    // header table
    let y = 150;
    const rowHeight = 18;
    const colX = { sku: 40, name: 100, category: 260, qty: 340, cost: 400, price: 480, value: 560, revenue: 670 };
    const width = { sku: 60, name: 160, category: 80, qty: 60, cost: 80, price: 80, value: 110, revenue: 120 };

    function drawHeader() {
      doc.font('Helvetica-Bold').fontSize(10);
      doc.rect(colX.sku, y, width.sku, rowHeight).stroke();
      doc.rect(colX.name, y, width.name, rowHeight).stroke();
      doc.rect(colX.category, y, width.category, rowHeight).stroke();
      doc.rect(colX.qty, y, width.qty, rowHeight).stroke();
      doc.rect(colX.cost, y, width.cost, rowHeight).stroke();
      doc.rect(colX.price, y, width.price, rowHeight).stroke();
      doc.rect(colX.value, y, width.value, rowHeight).stroke();
      doc.rect(colX.revenue, y, width.revenue, rowHeight).stroke();
      doc.text('SKU', colX.sku + 3, y + 4);
      doc.text('Product Name', colX.name + 3, y + 4);
      doc.text('Category', colX.category + 3, y + 4);
      doc.text('Quantity', colX.qty + 3, y + 4);
      doc.text('Unit Cost', colX.cost + 3, y + 4);
      doc.text('Unit Price', colX.price + 3, y + 4);
      doc.text('Total Inventory Value', colX.value + 3, y + 4);
      doc.text('Total Potential Revenue', colX.revenue + 3, y + 4);
      y += rowHeight;
      doc.font('Helvetica').fontSize(9);
    }
    drawHeader();

    let subtotalQty = 0, totalValue = 0, totalRevenue = 0, rowsOnPage = 0;
    for (const it of items) {
      if (rowsOnPage === 10) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });
        y = 40;
        rowsOnPage = 0;
        drawHeader();
      }
      const qty = Number(it.quantity || 0);
      const cost = Number(it.unitCost || 0);
      const price = Number(it.unitPrice || 0);
      const val = qty * cost;
      const rev = qty * price;
      subtotalQty += qty;
      totalValue += val;
      totalRevenue += rev;
      doc.rect(colX.sku, y, width.sku, rowHeight).stroke();
      doc.rect(colX.name, y, width.name, rowHeight).stroke();
      doc.rect(colX.category, y, width.category, rowHeight).stroke();
      doc.rect(colX.qty, y, width.qty, rowHeight).stroke();
      doc.rect(colX.cost, y, width.cost, rowHeight).stroke();
      doc.rect(colX.price, y, width.price, rowHeight).stroke();
      doc.rect(colX.value, y, width.value, rowHeight).stroke();
      doc.rect(colX.revenue, y, width.revenue, rowHeight).stroke();
      doc.text(it.sku || '', colX.sku + 3, y + 4);
      doc.text(it.name || '', colX.name + 3, y + 4);
      doc.text(it.category || '', colX.category + 3, y + 4);
      doc.text(String(qty), colX.qty + 3, y + 4);
      doc.text(`RM ${cost.toFixed(2)}`, colX.cost + 3, y + 4);
      doc.text(`RM ${price.toFixed(2)}`, colX.price + 3, y + 4);
      doc.text(`RM ${val.toFixed(2)}`, colX.value + 3, y + 4);
      doc.text(`RM ${rev.toFixed(2)}`, colX.revenue + 3, y + 4);
      y += rowHeight;
      rowsOnPage++;
    }

    // totals box
    const lastPageIndex = doc.bufferedPageRange().count - 1;
    doc.switchToPage(lastPageIndex);
    let boxY = y + 20;
    if (boxY > 480) boxY = 480;
    doc.rect(560, boxY, 230, 68).stroke();
    doc.font('Helvetica-Bold').fontSize(10).text(`Subtotal (Quantity): ${subtotalQty} units`, 570, boxY + 10);
    doc.text(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, 570, boxY + 28);
    doc.text(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, 570, boxY + 46);
    doc.flushPages();

    // footer + page numbers
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(9).text('Generated by L&B Company Inventory System', 0, doc.page.height - 40, { align: 'center' });
      doc.text(`Page ${i + 1} of ${pages.count}`, 0, doc.page.height - 25, { align: 'center' });
    }

    // finalize PDF
    doc.end();

    // when file saved to disk, create Doc record and log
    fileStream.on('finish', async () => {
      try {
        const stats = fs.statSync(outPath);
        await Doc.create({
          originalName: filename,
          storedName,
          path: outPath,
          size: stats.size,
          contentType: 'application/pdf',
          date: new Date()
        });
        await logActivity(printedBy, `Generated Inventory Report PDF: ${filename}`);
      } catch (err) {
        console.error('Failed to save generated PDF metadata:', err);
      }
    });

  } catch (err) {
    console.error('PDF Error:', err);
    res.status(500).json({ message: 'PDF generation failed' });
  }
});

// ========================= XLSX REPORT (generate file & save) =========================
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const filenameBase = `Inventory_Report_${new Date().toISOString().slice(0, 10)}`;
    const filename = `${filenameBase}.xlsx`;
    const storedName = `${Date.now()}__${filename.replace(/[^a-zA-Z0-9.\-_() ]/g,'_')}`;
    const outPath = path.join(UPLOADS_DIR, storedName);

    const ws_data = [
      ['L&B Company - Inventory Report'],
      ['Date:', new Date().toISOString().slice(0, 10)],
      [],
      ['SKU', 'Name', 'Category', 'Quantity', 'Unit Cost', 'Unit Price', 'Total Inventory Value', 'Total Potential Revenue']
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
    ws_data.push(['', '', '', 'Totals', '', '', totalValue.toFixed(2), totalRevenue.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Inventory Report');
    const wb_out = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // write to disk
    fs.writeFileSync(outPath, wb_out);

    // save metadata
    await Doc.create({ originalName: filename, storedName, path: outPath, size: wb_out.length, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Inventory Report XLSX`);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(wb_out);

  } catch (err) {
    console.error('XLSX error', err);
    res.status(500).json({ message: 'Report generation failed' });
  }
});

// ========================= DOCUMENTS CRUD (file-system backed) =========================
// List documents: returns metadata (no binary)
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date: -1 }).lean();
    const mapped = docs.map(d => ({
      id: d._id.toString(),
      name: d.originalName,
      storedName: d.storedName,
      size: d.size,
      date: d.date,
      contentType: d.contentType,
      downloadUrl: `/api/documents/download/${d._id.toString()}`
    }));
    res.json(mapped);
  } catch (err) {
    console.error('documents list error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Upload file: multipart/form-data field name 'file'
app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded. Use form field 'file'." });

    const { originalname, filename, mimetype, size, path: fpath } = req.file;
    const doc = await Doc.create({
      originalName: originalname,
      storedName: filename,
      path: fpath,
      size,
      contentType: mimetype,
      date: new Date()
    });

    await logActivity(req.headers['x-username'], `Uploaded document: ${originalname}`);

    res.status(201).json({
      id: doc._id.toString(),
      name: doc.originalName,
      size: doc.size,
      date: doc.date,
      downloadUrl: `/api/documents/download/${doc._id.toString()}`
    });
  } catch (err) {
    console.error('document upload error', err);
    res.status(500).json({ message: 'Server error during upload' });
  }
});

// Download by id: streams file with proper headers
app.get('/api/documents/download/:id', async (req, res) => {
  try {
    const docId = req.params.id;
    const doc = await Doc.findById(docId).lean();
    if (!doc) return res.status(404).json({ message: 'Document not found' });

    const filePath = doc.path;
    if (!filePath || !fs.existsSync(filePath)) {
      console.error('File missing on disk for doc:', doc);
      return res.status(404).json({ message: 'File not found on server' });
    }

    // send as attachment with original filename
    return res.download(filePath, doc.originalName, (err) => {
      if (err) {
        console.error('Download error:', err);
        // If headers already sent, cannot send JSON; just log
      } else {
        // successful download logged
        logActivity(req.headers['x-username'], `Downloaded document: ${doc.originalName}`).catch(()=>{});
      }
    });
  } catch (err) {
    console.error('document download error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete document and remove file from disk
app.delete('/api/documents/:id', async (req, res) => {
  try {
    const doc = await Doc.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Document not found' });

    const filePath = doc.path;
    await Doc.deleteOne({ _id: doc._id });
    if (filePath && fs.existsSync(filePath)) {
      try {
        await unlinkAsync(filePath);
      } catch (err) {
        console.error('Failed to remove file from disk:', err);
      }
    }
    await logActivity(req.headers['x-username'], `Deleted document: ${doc.originalName}`);
    res.status(204).send();
  } catch (err) {
    console.error('document delete error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ========================= ACTIVITY LOGS =========================
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    res.json(logs.map(l => ({ user: l.user, action: l.action, time: l.time ? new Date(l.time).toISOString() : new Date().toISOString() })));
  } catch (err) {
    console.error('logs error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ========================= SERVE FRONTEND =========================
app.use(express.static(path.join(__dirname, '../public')));

// route fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'API route not found' });
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ========================= STARTUP HELP + SERVER START =========================
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username: 'admin', password: 'password' });
      await logActivity('System', 'Default admin user created');
    }
    await logActivity('System', `Server started on port ${PORT}`);
  } catch (err) {
    console.error('Startup error:', err);
  }
}

(async () => {
  await ensureDefaultAdminAndStartupLog();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();
